import { expect, it, vi } from 'vitest';
import { createPblActivity } from '@/lib/pbl/v3/activity';

it('coalesces interaction bursts and never reports ordinary polling as activity', async () => {
  const send = vi.fn(async () => true);
  const changed = vi.fn();
  const activity = createPblActivity(send, changed);
  await activity.flush();
  expect(send).not.toHaveBeenCalled();
  for (let i = 0; i < 50; i++) activity.mark();
  await activity.flush();
  await activity.flush();
  expect(send).toHaveBeenCalledTimes(1);
});

it('retains failed batches and input arriving while a heartbeat is in flight', async () => {
  let finish!: (recorded: boolean) => void;
  const send = vi.fn(
    () =>
      new Promise<boolean>((resolve) => {
        finish = resolve;
      }),
  );
  const activity = createPblActivity(send, () => {});
  activity.mark();
  const first = activity.flush();
  await activity.flush();
  expect(send).toHaveBeenCalledTimes(1);
  activity.mark();
  finish(true);
  await first;
  const second = activity.flush();
  finish(false);
  await second;
  const retry = activity.flush();
  finish(true);
  await retry;
  await activity.flush();
  expect(send).toHaveBeenCalledTimes(3);
});
