'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { useMoltCloak } from '@/lib/hooks/useMoltCloak';
import { MoltPostCard } from '@/components/molt/MoltPostCard';
import { useCloakContext } from '@/components/cloak/shell/CloakContext';

export default function FeedPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const cloakId = params.id as string;
  const { templateId } = useCloakContext();

  const submoltFilter = searchParams.get('submolt') ? Number(searchParams.get('submolt')) : null;

  const {
    isConnecting,
    isConnected,
    error,
    posts,
    postCount,
    isLoadingPosts,
    isPublic,
    isPrivate,
    isMember,
    publicHoursPerDay,
    publicWindowStart,
    isCurrentlyPublic,
    loadPosts,
    loadComments,
    createPost,
    createComment,
    upvotePost,
    downvotePost,
    upvoteComment,
    downvoteComment,
  } = useMoltCloak(cloakId);

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newPostContent, setNewPostContent] = useState('');
  const [newPostSubmolt, setNewPostSubmolt] = useState(submoltFilter ?? 0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [page, setPage] = useState(1);

  // Load posts once connected, or via public-feed API if no wallet
  useEffect(() => {
    if (isConnected || !isMember) {
      loadPosts(page);
    }
  }, [isConnected, isMember, page, loadPosts]);

  const handleCreatePost = useCallback(async () => {
    if (!newPostContent.trim()) return;
    setIsSubmitting(true);
    const postId = await createPost(newPostContent, newPostSubmolt);
    if (postId !== null) {
      setNewPostContent('');
      setShowCreateForm(false);
      await loadPosts(1);
      setPage(1);
    }
    setIsSubmitting(false);
  }, [newPostContent, newPostSubmolt, createPost, loadPosts]);

  // Non-Molt template guard
  if (templateId !== 10) {
    return (
      <div className="p-6 text-center text-foreground-muted">
        Feed is only available for Molt cloaks.
      </div>
    );
  }

  if (isConnecting) {
    return (
      <div className="p-6 space-y-4 animate-shimmer">
        <div className="h-8 bg-background-tertiary rounded-md w-1/4" />
        <div className="h-32 bg-background-tertiary rounded-md" />
        <div className="h-32 bg-background-tertiary rounded-md" />
      </div>
    );
  }

  if (error && !isConnected) {
    return (
      <div className="p-6">
        <div className="p-4 bg-status-error/10 border border-status-error rounded-md text-status-error">
          {error}
        </div>
      </div>
    );
  }

  // Private Molt guard for non-members
  if (isPrivate && !isMember) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <svg className="w-16 h-16 mx-auto text-foreground-muted mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
          <h1 className="text-xl font-bold text-foreground mb-2">This Molt is dark</h1>
          <p className="text-foreground-muted text-sm">
            {publicHoursPerDay > 0 && publicHoursPerDay < 24
              ? `Public viewing: ${String(publicWindowStart).padStart(2, '0')}:00 – ${String((publicWindowStart + publicHoursPerDay) % 24).padStart(2, '0')}:00 UTC`
              : 'This Molt\u2019s discussions are not publicly visible.'}
          </p>
        </div>
      </div>
    );
  }

  // Filter posts by submolt if filter is active
  const filteredPosts = submoltFilter !== null
    ? posts.filter((p) => p.submoltId === submoltFilter)
    : posts;

  const totalPages = Math.max(1, Math.ceil(postCount / 20));

  return (
    <div className="p-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <p className="text-sm text-foreground-muted">
            {submoltFilter !== null ? (
              <>
                {filteredPosts.length} {filteredPosts.length === 1 ? 'post' : 'posts'} in this subcloak
                <span className="mx-1.5">·</span>
                <a href={`/cloak/${cloakId}/feed`} className="text-accent hover:text-accent-hover">
                  View all
                </a>
              </>
            ) : (
              <>
                {postCount} {postCount === 1 ? 'post' : 'posts'}
              </>
            )}
            {publicHoursPerDay > 0 && publicHoursPerDay < 24 && (
              <span className="ml-2 inline-flex items-center gap-1 text-xs px-1.5 py-0.5 bg-accent/10 text-accent rounded">
                {isCurrentlyPublic
                  ? `Public ${String(publicWindowStart).padStart(2, '0')}:00 – ${String((publicWindowStart + publicHoursPerDay) % 24).padStart(2, '0')}:00 UTC`
                  : `Dark until ${String(publicWindowStart).padStart(2, '0')}:00 UTC`}
              </span>
            )}
            {publicHoursPerDay === 0 && (
              <span className="ml-2 inline-flex items-center gap-1 text-xs px-1.5 py-0.5 bg-accent/10 text-accent rounded">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
                Always Private
              </span>
            )}
          </p>
        </div>
        {isMember && (
          <button
            onClick={() => setShowCreateForm(!showCreateForm)}
            className="px-4 py-2 bg-accent hover:bg-accent-hover text-white text-sm rounded-md transition-colors"
          >
            New Post
          </button>
        )}
      </div>

      {/* Create Post Form */}
      {showCreateForm && (
        <div className="mb-6 bg-card border border-border rounded-md p-4">
          <textarea
            value={newPostContent}
            onChange={(e) => setNewPostContent(e.target.value)}
            placeholder="What's on your mind?"
            rows={4}
            className="w-full bg-background-secondary border border-border rounded-md px-3 py-2 text-sm text-foreground placeholder:text-foreground-muted resize-y focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <div className="flex justify-between items-center mt-3">
            <div className="flex items-center gap-3">
              <span className="text-xs text-foreground-muted">
                {!isPublic ? 'Content will be encrypted before storage.' : 'Content will be stored publicly.'}
              </span>
              <div className="flex items-center gap-1.5">
                <label className="text-xs text-foreground-muted">Subcloak:</label>
                <input
                  type="number"
                  value={newPostSubmolt}
                  onChange={(e) => setNewPostSubmolt(Number(e.target.value))}
                  min={0}
                  className="w-16 bg-background-secondary border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
                  placeholder="0"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setShowCreateForm(false)}
                className="px-3 py-1.5 text-sm text-foreground-muted hover:text-foreground-secondary transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreatePost}
                disabled={isSubmitting || !newPostContent.trim()}
                className="px-4 py-1.5 bg-accent hover:bg-accent-hover text-white text-sm rounded-md transition-colors disabled:opacity-50"
              >
                {isSubmitting ? 'Posting...' : 'Post'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Posts */}
      {isLoadingPosts ? (
        <div className="space-y-4 animate-shimmer">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-32 bg-background-tertiary rounded-md" />
          ))}
        </div>
      ) : filteredPosts.length === 0 ? (
        <div className="text-center py-16 bg-background-secondary rounded-md">
          <svg className="w-12 h-12 mx-auto text-foreground-muted mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
          </svg>
          <p className="text-foreground-muted">
            {submoltFilter !== null ? 'No posts in this subcloak yet.' : 'No posts yet.'}
          </p>
          {isMember && (
            <p className="text-sm text-foreground-muted mt-1">Be the first to post.</p>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {filteredPosts.map((post) => (
            <MoltPostCard
              key={post.id}
              post={post}
              isMember={isMember}
              onUpvote={upvotePost}
              onDownvote={downvotePost}
              onLoadComments={loadComments}
              onCreateComment={createComment}
              onUpvoteComment={upvoteComment}
              onDownvoteComment={downvoteComment}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 mt-8">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1.5 text-sm border border-border rounded-md hover:bg-card-hover disabled:opacity-30 transition-colors"
          >
            Previous
          </button>
          <span className="text-sm text-foreground-muted">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-3 py-1.5 text-sm border border-border rounded-md hover:bg-card-hover disabled:opacity-30 transition-colors"
          >
            Next
          </button>
        </div>
      )}

      {/* Public viewer notice */}
      {!isMember && isPublic && (
        <div className="mt-6 p-3 bg-background-secondary border border-border rounded-md text-center">
          <p className="text-sm text-foreground-muted">
            You are viewing this feed as a public observer. Connect your wallet and join this Molt to participate.
          </p>
        </div>
      )}
    </div>
  );
}
