/** Shared JSON shape for the owner Thread (SSR + /api/app/thread poller). */
export type ThreadMessageDto = {
  id: string;
  direction: 'inbound' | 'outbound';
  body: string | null;
  mediaUrl: string | null;
  createdAt: string;
};
