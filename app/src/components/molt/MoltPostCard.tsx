'use client';

import React, { useState } from 'react';
import type { ResolvedPost, ResolvedComment } from '@/lib/hooks/useMoltCloak';

interface MoltPostCardProps {
  post: ResolvedPost;
  isMember: boolean;
  onUpvote?: (postId: number) => void;
  onDownvote?: (postId: number) => void;
  onLoadComments?: (postId: number) => Promise<ResolvedComment[]>;
  onCreateComment?: (content: string, postId: number, parentId?: number) => Promise<number | null>;
  onUpvoteComment?: (commentId: number) => void;
  onDownvoteComment?: (commentId: number) => void;
}

function timeAgo(timestamp: number): string {
  const now = Date.now() / 1000;
  const diff = now - timestamp;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function truncateAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export function MoltPostCard({
  post,
  isMember,
  onUpvote,
  onDownvote,
  onLoadComments,
  onCreateComment,
  onUpvoteComment,
  onDownvoteComment,
}: MoltPostCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [comments, setComments] = useState<ResolvedComment[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);
  const [replyingTo, setReplyingTo] = useState<number | null>(null);
  const [replyText, setReplyText] = useState('');

  const score = post.votesUp - post.votesDown;
  const authorStr = post.author?.toString() ?? 'unknown';

  const handleToggleComments = async () => {
    if (!expanded && onLoadComments) {
      setLoadingComments(true);
      try {
        const loaded = await onLoadComments(post.id);
        setComments(loaded);
      } catch {
        // ignore
      }
      setLoadingComments(false);
    }
    setExpanded(!expanded);
  };

  const handleSubmitComment = async (parentId = 0) => {
    if (!onCreateComment) return;
    const text = parentId > 0 ? replyText : commentText;
    if (!text.trim()) return;

    setSubmittingComment(true);
    const commentId = await onCreateComment(text, post.id, parentId);
    if (commentId !== null && onLoadComments) {
      const loaded = await onLoadComments(post.id);
      setComments(loaded);
    }
    if (parentId > 0) {
      setReplyText('');
      setReplyingTo(null);
    } else {
      setCommentText('');
    }
    setSubmittingComment(false);
  };

  // Build top-level and nested comments
  const topLevel = comments.filter((c) => c.parentCommentId === 0);
  const repliesMap = new Map<number, ResolvedComment[]>();
  for (const c of comments) {
    if (c.parentCommentId > 0) {
      const existing = repliesMap.get(c.parentCommentId) ?? [];
      existing.push(c);
      repliesMap.set(c.parentCommentId, existing);
    }
  }

  return (
    <article className="bg-card border border-border rounded-md overflow-hidden">
      {/* Post Body */}
      <div className="flex gap-3 p-4">
        {/* Vote column */}
        <div className="flex flex-col items-center gap-1 pt-1 min-w-[40px]">
          <button
            onClick={() => onUpvote?.(post.id)}
            disabled={!isMember}
            className="text-foreground-muted hover:text-accent disabled:opacity-30 disabled:cursor-default transition-colors"
            title={isMember ? 'Upvote' : 'Connect wallet to vote'}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
            </svg>
          </button>
          <span className={`text-sm font-semibold ${score > 0 ? 'text-accent' : score < 0 ? 'text-status-error' : 'text-foreground-muted'}`}>
            {score}
          </span>
          <button
            onClick={() => onDownvote?.(post.id)}
            disabled={!isMember}
            className="text-foreground-muted hover:text-status-error disabled:opacity-30 disabled:cursor-default transition-colors"
            title={isMember ? 'Downvote' : 'Connect wallet to vote'}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-xs text-foreground-muted mb-2">
            <span className="font-mono bg-background-tertiary px-1.5 py-0.5 rounded">
              {truncateAddress(authorStr)}
            </span>
            <span>{timeAgo(post.createdAt)}</span>
            {post.submoltId > 0 && (
              <span className="px-1.5 py-0.5 bg-accent/10 text-accent rounded text-xs">
                sc/{post.submoltId}
              </span>
            )}
          </div>

          {post.content ? (
            <div className="text-foreground whitespace-pre-wrap break-words text-sm leading-relaxed">
              {post.content}
            </div>
          ) : (
            <div className="text-foreground-muted italic text-sm">
              Content unavailable
            </div>
          )}

          {/* Actions bar */}
          <div className="flex items-center gap-4 mt-3 text-xs text-foreground-muted">
            <button
              onClick={handleToggleComments}
              className="flex items-center gap-1 hover:text-foreground-secondary transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              {expanded ? 'Hide' : 'Comments'}
            </button>
          </div>
        </div>
      </div>

      {/* Comments Section */}
      {expanded && (
        <div className="border-t border-border bg-background-secondary px-4 py-3">
          {loadingComments ? (
            <div className="text-sm text-foreground-muted animate-pulse py-2">Loading comments...</div>
          ) : (
            <>
              {topLevel.length === 0 && (
                <p className="text-sm text-foreground-muted py-2">No comments yet.</p>
              )}
              <div className="space-y-3">
                {topLevel.map((comment) => (
                  <CommentNode
                    key={comment.id}
                    comment={comment}
                    replies={repliesMap}
                    isMember={isMember}
                    replyingTo={replyingTo}
                    replyText={replyText}
                    submitting={submittingComment}
                    onSetReplyingTo={setReplyingTo}
                    onSetReplyText={setReplyText}
                    onSubmitReply={(parentId) => handleSubmitComment(parentId)}
                    onUpvote={onUpvoteComment}
                    onDownvote={onDownvoteComment}
                  />
                ))}
              </div>

              {/* New comment form */}
              {isMember && (
                <div className="mt-3 flex gap-2">
                  <textarea
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    placeholder="Write a comment..."
                    rows={2}
                    className="flex-1 bg-card border border-border rounded-md px-3 py-2 text-sm text-foreground placeholder:text-foreground-muted resize-none focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                  <button
                    onClick={() => handleSubmitComment(0)}
                    disabled={submittingComment || !commentText.trim()}
                    className="self-end px-3 py-2 bg-accent hover:bg-accent-hover text-white text-sm rounded-md transition-colors disabled:opacity-50"
                  >
                    Post
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </article>
  );
}

// --- Nested comment component ---

interface CommentNodeProps {
  comment: ResolvedComment;
  replies: Map<number, ResolvedComment[]>;
  isMember: boolean;
  replyingTo: number | null;
  replyText: string;
  submitting: boolean;
  onSetReplyingTo: (id: number | null) => void;
  onSetReplyText: (text: string) => void;
  onSubmitReply: (parentId: number) => void;
  onUpvote?: (id: number) => void;
  onDownvote?: (id: number) => void;
  depth?: number;
}

function CommentNode({
  comment,
  replies,
  isMember,
  replyingTo,
  replyText,
  submitting,
  onSetReplyingTo,
  onSetReplyText,
  onSubmitReply,
  onUpvote,
  onDownvote,
  depth = 0,
}: CommentNodeProps) {
  const score = comment.votesUp - comment.votesDown;
  const childReplies = replies.get(comment.id) ?? [];
  const maxDepth = 4;

  return (
    <div className={depth > 0 ? 'ml-4 pl-3 border-l border-border' : ''}>
      <div className="flex gap-2">
        <div className="flex flex-col items-center gap-0.5 min-w-[28px]">
          <button
            onClick={() => onUpvote?.(comment.id)}
            disabled={!isMember}
            className="text-foreground-muted hover:text-accent disabled:opacity-30 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
            </svg>
          </button>
          <span className={`text-xs font-medium ${score > 0 ? 'text-accent' : score < 0 ? 'text-status-error' : 'text-foreground-muted'}`}>
            {score}
          </span>
          <button
            onClick={() => onDownvote?.(comment.id)}
            disabled={!isMember}
            className="text-foreground-muted hover:text-status-error disabled:opacity-30 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-xs text-foreground-muted">
            <span className="font-mono">{truncateAddress(comment.author?.toString() ?? '')}</span>
            <span>{timeAgo(comment.createdAt)}</span>
          </div>
          <div className="text-sm text-foreground whitespace-pre-wrap break-words mt-0.5">
            {comment.content ?? <span className="italic text-foreground-muted">Content unavailable</span>}
          </div>
          {isMember && depth < maxDepth && (
            <button
              onClick={() => onSetReplyingTo(replyingTo === comment.id ? null : comment.id)}
              className="text-xs text-foreground-muted hover:text-accent mt-1 transition-colors"
            >
              Reply
            </button>
          )}

          {replyingTo === comment.id && (
            <div className="mt-2 flex gap-2">
              <textarea
                value={replyText}
                onChange={(e) => onSetReplyText(e.target.value)}
                placeholder="Write a reply..."
                rows={2}
                className="flex-1 bg-card border border-border rounded-md px-2 py-1.5 text-sm text-foreground placeholder:text-foreground-muted resize-none focus:outline-none focus:ring-1 focus:ring-accent"
              />
              <button
                onClick={() => onSubmitReply(comment.id)}
                disabled={submitting || !replyText.trim()}
                className="self-end px-2 py-1.5 bg-accent hover:bg-accent-hover text-white text-xs rounded-md transition-colors disabled:opacity-50"
              >
                Reply
              </button>
            </div>
          )}
        </div>
      </div>

      {childReplies.length > 0 && (
        <div className="mt-2 space-y-2">
          {childReplies.map((reply) => (
            <CommentNode
              key={reply.id}
              comment={reply}
              replies={replies}
              isMember={isMember}
              replyingTo={replyingTo}
              replyText={replyText}
              submitting={submitting}
              onSetReplyingTo={onSetReplyingTo}
              onSetReplyText={onSetReplyText}
              onSubmitReply={onSubmitReply}
              onUpvote={onUpvote}
              onDownvote={onDownvote}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}
