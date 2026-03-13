export type PaginationInput = {
  page?: number;
  limit?: number;
};

export function toPagination(input: PaginationInput): { skip: number; take: number; page: number; limit: number } {
  const page = Math.max(1, input.page ?? 1);
  const limit = Math.min(Math.max(1, input.limit ?? 20), 100);
  const skip = (page - 1) * limit;

  return { skip, take: limit, page, limit };
}
