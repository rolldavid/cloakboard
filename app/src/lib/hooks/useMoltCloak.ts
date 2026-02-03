'use client';

/**
 * useMoltCloak — Hook for connecting to and reading from a Molt Cloak contract.
 *
 * Provides post/comment reading, content resolution (with encryption support),
 * and write operations (upvote, downvote, create post/comment) for members.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { useWalletContext } from '@/components/wallet/WalletProvider';
import { useAztecStore } from '@/store/aztecStore';
import type { MoltPost, MoltComment } from '@/lib/templates/MoltCloakService';

export interface ResolvedPost extends MoltPost {
  content: string | null;
  commentCount?: number;
}

export interface ResolvedComment extends MoltComment {
  content: string | null;
  replies?: ResolvedComment[];
}

interface MoltCloakState {
  isConnecting: boolean;
  isConnected: boolean;
  error: string | null;
  posts: ResolvedPost[];
  postCount: number;
  isLoadingPosts: boolean;
  isPrivate: boolean;
  publicHoursPerDay: number;
  publicWindowStart: number;
  isCurrentlyPublic: boolean;
}

// Lazy-loaded modules
let moltModules: {
  MoltCloakService: any;
  getMoltCloakArtifact: () => Promise<any>;
  AztecAddress: any;
  resolveContent: (hash: bigint, cloakId: string) => Promise<string | null>;
  encryptContent: (plaintext: string, key: CryptoKey) => Promise<string>;
  decryptContent: (encrypted: string, key: CryptoKey) => Promise<string>;
  isEncryptedPayload: (content: string) => boolean;
  hashContent: (plaintext: string) => Promise<bigint>;
  publishContent: (hash: bigint, plaintext: string, cloakId: string) => Promise<void>;
} | null = null;

async function loadModules() {
  if (moltModules) return moltModules;

  const [moltMod, contractsMod, addressesMod, contentMod, cryptoMod] = await Promise.all([
    import('@/lib/templates/MoltCloakService'),
    import('@/lib/aztec/contracts'),
    import('@aztec/aztec.js/addresses'),
    import('@/lib/molt/MoltContentService'),
    import('@/lib/molt/MoltCryptoService'),
  ]);

  moltModules = {
    MoltCloakService: moltMod.MoltCloakService,
    getMoltCloakArtifact: contractsMod.getMoltCloakArtifact,
    AztecAddress: addressesMod.AztecAddress,
    resolveContent: contentMod.resolveContent,
    hashContent: contentMod.hashContent,
    publishContent: contentMod.publishContent,
    encryptContent: cryptoMod.encryptContent,
    decryptContent: cryptoMod.decryptContent,
    isEncryptedPayload: cryptoMod.isEncryptedPayload,
  };

  return moltModules;
}

// Global cache of connected MoltCloakService instances keyed by actual contract address.
// This survives across tab navigations so the expensive connect() only runs once per session.
const connectedServiceCache = new Map<string, any>();

export function useMoltCloak(cloakAddress: string) {
  const { client, account } = useWalletContext();
  const storeCloak = useAztecStore((s) =>
    s.cloakList.find((d) => d.slug === cloakAddress || d.address === cloakAddress)
  );

  const serviceRef = useRef<any>(null);
  const encryptionKeyRef = useRef<CryptoKey | null>(null);

  const [isVerifiedAgent, setIsVerifiedAgent] = useState(false);

  const [state, setState] = useState<MoltCloakState>({
    isConnecting: false,
    isConnected: false,
    error: null,
    posts: [],
    postCount: 0,
    isLoadingPosts: false,
    isPrivate: false,
    publicHoursPerDay: 24,
    publicWindowStart: 10,
    isCurrentlyPublic: true,
  });

  const isPublic = storeCloak?.isPubliclyViewable ?? true;
  const actualAddress = storeCloak?.address ?? cloakAddress;

  // Connect to the Molt contract (uses global cache to avoid re-connecting on tab switch)
  const connect = useCallback(async () => {
    if (!client || serviceRef.current) return;

    // Check global cache first
    const cached = connectedServiceCache.get(actualAddress);
    if (cached) {
      serviceRef.current = cached;
      setState((prev) => ({ ...prev, isConnecting: false, isConnected: true }));
      // Check verified agent status with cached service
      if (account?.address) {
        const modules = await loadModules();
        try {
          const verified = await cached.isAgentVerified(
            modules.AztecAddress.fromString(account.address)
          );
          setIsVerifiedAgent(verified);
        } catch { /* non-critical */ }
      }
      return;
    }

    setState((prev) => ({ ...prev, isConnecting: true, error: null }));

    try {
      const modules = await loadModules();
      const walletAddress = client.getAddress?.();
      const paymentMethod = client.getPaymentMethod?.();
      const service = new modules.MoltCloakService(
        client.getWallet(),
        walletAddress,
        paymentMethod
      );
      const artifact = await modules.getMoltCloakArtifact();
      await service.connect(
        modules.AztecAddress.fromString(actualAddress),
        artifact
      );
      serviceRef.current = service;
      connectedServiceCache.set(actualAddress, service);
      setState((prev) => ({ ...prev, isConnecting: false, isConnected: true }));

      // Check if current user is a verified agent (for proposal/vote gating)
      if (account?.address) {
        try {
          const verified = await service.isAgentVerified(
            modules.AztecAddress.fromString(account.address)
          );
          setIsVerifiedAgent(verified);
        } catch {
          // Non-critical — default to not verified
        }
      }
    } catch (err) {
      console.error('[useMoltCloak] Connect failed:', err);
      setState((prev) => ({
        ...prev,
        isConnecting: false,
        error: err instanceof Error ? err.message : 'Failed to connect to Molt contract',
      }));
    }
  }, [client, actualAddress, account]);

  useEffect(() => {
    if (client) {
      connect();
    }
    // If no wallet, we still want loadPosts to work via public-feed API.
    // The caller triggers loadPosts after checking isConnected or on mount.
  }, [connect, client]);

  // Resolve content: fetch from R2, decrypt if needed
  const resolvePostContent = useCallback(async (contentHash: bigint): Promise<string | null> => {
    try {
      const modules = await loadModules();
      const raw = await modules.resolveContent(contentHash, actualAddress);
      if (!raw) return null;

      // If this is a private cloak and content is encrypted, decrypt
      if (!isPublic && encryptionKeyRef.current && modules.isEncryptedPayload(raw)) {
        try {
          return await modules.decryptContent(raw, encryptionKeyRef.current);
        } catch {
          // Decryption failed — might be legacy unencrypted content
          return raw;
        }
      }

      return raw;
    } catch {
      return null;
    }
  }, [actualAddress, isPublic]);

  // Load posts — uses direct contract reads when wallet connected, public-feed API otherwise
  const loadPosts = useCallback(async (page = 1, limit = 20) => {
    const service = serviceRef.current;

    // If no wallet/service, fall back to public-feed API
    if (!service) {
      setState((prev) => ({ ...prev, isLoadingPosts: true }));
      try {
        const res = await fetch(`/api/v1/molt/${actualAddress}/public-feed?page=${page}&limit=${limit}`);
        const data = await res.json();

        if (data.private) {
          setState((prev) => ({
            ...prev,
            isPrivate: true,
            isLoadingPosts: false,
            publicHoursPerDay: data.public_hours_per_day ?? 0,
            publicWindowStart: data.window_start_utc ?? 10,
            isCurrentlyPublic: false,
          }));
          return;
        }

        const posts: ResolvedPost[] = (data.posts || []).map((p: any) => ({
          id: p.id,
          contentHash: BigInt(0),
          author: p.author,
          submoltId: p.submoltId,
          createdAt: p.createdAt,
          votesUp: p.votesUp,
          votesDown: p.votesDown,
          deleted: false,
          content: p.content,
        }));

        setState((prev) => ({
          ...prev,
          posts,
          postCount: data.total || 0,
          isLoadingPosts: false,
          isPrivate: false,
        }));
      } catch (err) {
        console.error('[useMoltCloak] Public feed fetch failed:', err);
        setState((prev) => ({
          ...prev,
          isLoadingPosts: false,
          error: err instanceof Error ? err.message : 'Failed to load posts',
        }));
      }
      return;
    }

    setState((prev) => ({ ...prev, isLoadingPosts: true }));

    try {
      const postCount = await service.getPostCount();
      const start = Math.max(1, postCount - (page - 1) * limit - limit + 1);
      const end = Math.min(postCount, postCount - (page - 1) * limit);

      const posts: ResolvedPost[] = [];
      for (let i = end; i >= start; i--) {
        try {
          const post = await service.getPost(i);
          if (post.deleted) continue;
          const content = await resolvePostContent(post.contentHash);
          posts.push({ ...post, content });
        } catch (err) {
          console.warn(`[useMoltCloak] Failed to load post ${i}:`, err);
        }
      }

      setState((prev) => ({
        ...prev,
        posts,
        postCount,
        isLoadingPosts: false,
      }));
    } catch (err) {
      console.error('[useMoltCloak] Failed to load posts:', err);
      setState((prev) => ({
        ...prev,
        isLoadingPosts: false,
        error: err instanceof Error ? err.message : 'Failed to load posts',
      }));
    }
  }, [resolvePostContent, actualAddress]);

  // Load comments for a post — uses direct reads when wallet connected, API otherwise
  const loadComments = useCallback(async (postId: number): Promise<ResolvedComment[]> => {
    const service = serviceRef.current;

    // If no wallet/service, fall back to public-feed comments API
    if (!service) {
      try {
        const res = await fetch(`/api/v1/molt/${actualAddress}/public-feed/${postId}/comments`);
        const data = await res.json();
        if (data.private) return [];

        return (data.comments || []).map((c: any) => ({
          id: c.id,
          contentHash: BigInt(0),
          author: c.author,
          postId: c.postId,
          parentCommentId: c.parentCommentId,
          votesUp: c.votesUp,
          votesDown: c.votesDown,
          createdAt: c.createdAt,
          deleted: false,
          content: c.content,
        }));
      } catch {
        return [];
      }
    }

    try {
      const commentCount = await service.getCommentCount();
      const comments: ResolvedComment[] = [];

      for (let i = 1; i <= commentCount; i++) {
        try {
          const comment = await service.getComment(i);
          if (comment.postId !== postId) continue;
          const content = await resolvePostContent(comment.contentHash);
          comments.push({ ...comment, content });
        } catch {
          // skip failed comments
        }
      }

      return comments;
    } catch {
      return [];
    }
  }, [resolvePostContent, actualAddress]);

  // Write operations (member-only)

  const createPost = useCallback(async (plaintext: string, submoltId = 0): Promise<number | null> => {
    const service = serviceRef.current;
    if (!service) return null;

    try {
      const modules = await loadModules();

      // Encrypt if private cloak with key
      let contentToStore = plaintext;
      if (!isPublic && encryptionKeyRef.current) {
        contentToStore = await modules.encryptContent(plaintext, encryptionKeyRef.current);
      }

      const contentHash = await modules.hashContent(contentToStore);
      await modules.publishContent(contentHash, contentToStore, actualAddress);
      const { postId } = await service.createPost(contentHash, submoltId);
      return postId;
    } catch (err) {
      console.error('[useMoltCloak] Create post failed:', err);
      return null;
    }
  }, [actualAddress, isPublic]);

  const createComment = useCallback(async (
    plaintext: string,
    postId: number,
    parentCommentId = 0
  ): Promise<number | null> => {
    const service = serviceRef.current;
    if (!service) return null;

    try {
      const modules = await loadModules();

      let contentToStore = plaintext;
      if (!isPublic && encryptionKeyRef.current) {
        contentToStore = await modules.encryptContent(plaintext, encryptionKeyRef.current);
      }

      const contentHash = await modules.hashContent(contentToStore);
      await modules.publishContent(contentHash, contentToStore, actualAddress);
      const { commentId } = await service.createComment(contentHash, postId, parentCommentId);
      return commentId;
    } catch (err) {
      console.error('[useMoltCloak] Create comment failed:', err);
      return null;
    }
  }, [actualAddress, isPublic]);

  const upvotePost = useCallback(async (postId: number) => {
    const service = serviceRef.current;
    if (!service) return;
    try {
      await service.upvotePost(postId);
      await loadPosts();
    } catch (err) {
      console.error('[useMoltCloak] Upvote failed:', err);
    }
  }, [loadPosts]);

  const downvotePost = useCallback(async (postId: number) => {
    const service = serviceRef.current;
    if (!service) return;
    try {
      await service.downvotePost(postId);
      await loadPosts();
    } catch (err) {
      console.error('[useMoltCloak] Downvote failed:', err);
    }
  }, [loadPosts]);

  const upvoteComment = useCallback(async (commentId: number) => {
    const service = serviceRef.current;
    if (!service) return;
    try {
      await service.upvoteComment(commentId);
    } catch (err) {
      console.error('[useMoltCloak] Upvote comment failed:', err);
    }
  }, []);

  const downvoteComment = useCallback(async (commentId: number) => {
    const service = serviceRef.current;
    if (!service) return;
    try {
      await service.downvoteComment(commentId);
    } catch (err) {
      console.error('[useMoltCloak] Downvote comment failed:', err);
    }
  }, []);

  // Set encryption key (called by parent when key is available from Aztec private state)
  const setEncryptionKey = useCallback((key: CryptoKey) => {
    encryptionKeyRef.current = key;
  }, []);

  return {
    ...state,
    isPublic,
    isPrivate: state.isPrivate,
    publicHoursPerDay: state.publicHoursPerDay,
    publicWindowStart: state.publicWindowStart,
    isCurrentlyPublic: state.isCurrentlyPublic,
    cloakName: storeCloak?.name ?? cloakAddress,
    loadPosts,
    loadComments,
    createPost,
    createComment,
    upvotePost,
    downvotePost,
    upvoteComment,
    downvoteComment,
    setEncryptionKey,
    isMember: isVerifiedAgent,
  };
}
