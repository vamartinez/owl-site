import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { MessageSquare, Send } from 'lucide-react';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ErrorDisplay } from '@/components/ui/ErrorDisplay';
import { useIncidentComments, useAddComment } from './hooks/useIncidentComments';
import { commentSchema, type CommentFormData } from './schemas';
import type { IncidentComment } from './types';

interface CommentsSectionProps {
  incidentId: string | undefined;
}

/**
 * Chronological comments display with add form.
 * Validates non-empty content (max 5000 chars); shows inline error on failure;
 * preserves text on submission error. Wired to useIncidentComments and useAddComment
 * hooks with optimistic append.
 *
 * Requirements: 14.1, 14.2, 14.3, 14.4
 */
export function CommentsSection({ incidentId }: CommentsSectionProps) {
  const {
    data: comments,
    isLoading,
    isError,
    error: fetchError,
    refetch,
  } = useIncidentComments(incidentId);

  const addComment = useAddComment();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm<CommentFormData>({
    resolver: zodResolver(commentSchema),
    defaultValues: { content: '' },
  });

  const contentValue = watch('content');
  const charCount = contentValue?.length ?? 0;

  const onSubmit = (data: CommentFormData) => {
    if (!incidentId) return;

    setSubmitError(null);

    addComment.mutate(
      { incidentId, content: data.content },
      {
        onSuccess: () => {
          reset();
        },
        onError: (err) => {
          // Preserve text on submission error — do NOT reset the form
          setSubmitError(
            err.message || 'Failed to add comment. Please try again.'
          );
        },
      }
    );
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader title="Comments" description="Investigation notes and follow-up" />
        <CardContent>
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex gap-3 animate-pulse">
                <div className="h-8 w-8 rounded-full bg-gray-100 shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-gray-100 rounded w-1/4" />
                  <div className="h-3 bg-gray-100 rounded w-3/4" />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card>
        <CardHeader title="Comments" description="Investigation notes and follow-up" />
        <CardContent>
          <ErrorDisplay
            error={fetchError}
            title="Failed to load comments"
            onRetry={() => refetch()}
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title="Comments"
        description="Investigation notes and follow-up"
      />
      <CardContent>
        {/* Comments list */}
        {!comments || comments.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-6">
            No comments yet. Add the first comment below.
          </p>
        ) : (
          <ul className="space-y-4 mb-6" aria-label="Comments list">
            {comments.map((comment) => (
              <CommentItem key={comment.comment_id} comment={comment} />
            ))}
          </ul>
        )}

        {/* Add comment form */}
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
          <div>
            <label htmlFor="comment-content" className="sr-only">
              Add a comment
            </label>
            <textarea
              id="comment-content"
              {...register('content')}
              placeholder="Add a comment..."
              rows={3}
              className={`
                w-full rounded-md border px-3 py-2 text-sm
                placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-offset-1
                resize-y min-h-[80px]
                ${
                  errors.content
                    ? 'border-red-300 focus:ring-red-500'
                    : 'border-gray-300 focus:ring-primary-500'
                }
              `}
              aria-invalid={!!errors.content}
              aria-describedby={
                errors.content ? 'comment-error' : undefined
              }
            />
            <div className="flex items-center justify-between mt-1">
              <div>
                {errors.content && (
                  <p
                    id="comment-error"
                    className="text-xs text-red-600"
                    role="alert"
                  >
                    {errors.content.message}
                  </p>
                )}
                {submitError && (
                  <p className="text-xs text-red-600" role="alert">
                    {submitError}
                  </p>
                )}
              </div>
              <span
                className={`text-xs ${
                  charCount > 5000 ? 'text-red-600' : 'text-gray-400'
                }`}
              >
                {charCount}/5000
              </span>
            </div>
          </div>

          <div className="flex justify-end">
            <Button
              type="submit"
              size="sm"
              disabled={addComment.isPending || !incidentId}
            >
              <Send size={14} />
              {addComment.isPending ? 'Sending...' : 'Add Comment'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/**
 * Individual comment display with author, timestamp, and content.
 */
function CommentItem({ comment }: { comment: IncidentComment }) {
  const isOptimistic = comment.comment_id.startsWith('temp-');

  return (
    <li
      className={`flex gap-3 ${isOptimistic ? 'opacity-60' : ''}`}
      aria-label={`Comment by ${comment.author_name}`}
    >
      <div className="flex items-center justify-center h-8 w-8 rounded-full bg-primary-50 shrink-0">
        <MessageSquare size={14} className="text-primary-600" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-gray-900">
            {comment.author_name}
          </span>
          <span className="text-xs text-gray-400">
            {formatCommentTimestamp(comment.created_at)}
          </span>
          {isOptimistic && (
            <span className="text-xs text-gray-400 italic">Sending...</span>
          )}
        </div>
        <p className="text-sm text-gray-700 mt-0.5 whitespace-pre-wrap break-words">
          {comment.content}
        </p>
      </div>
    </li>
  );
}

/**
 * Formats an ISO 8601 timestamp to a human-readable string.
 */
function formatCommentTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  if (isNaN(date.getTime())) return timestamp;
  return date.toLocaleString('en-US', {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }) + ' UTC';
}
