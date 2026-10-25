export function checkAcceptanceRegion(body: string | null): { valid: boolean; reason: string };

type Target = { owner: string; repo: string; issue_number: number };
type Comment = { id: number; body?: string | null; user?: { login: string } | null };
type ListComments = (args: Target & { per_page?: number }) => Promise<unknown>;
export function enforceIssueReadiness(github: {
  rest: { issues: {
    get(args: Target): Promise<{ data: { body: string | null; state: string; labels: (string | { name?: string })[] } }>;
    listComments: ListComments;
    removeLabel(args: Target & { name: string }): Promise<unknown>;
    addLabels(args: Target & { labels: string[] }): Promise<unknown>;
    createComment(args: Target & { body: string }): Promise<unknown>;
    updateComment(args: { owner: string; repo: string; comment_id: number; body: string }): Promise<unknown>;
  } };
  paginate(method: ListComments, args: Target & { per_page: number }): Promise<Comment[]>;
}, context: { repo: { owner: string; repo: string }; issue: { number: number } }): Promise<void>;
