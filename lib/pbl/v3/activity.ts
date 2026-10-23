/** Coalesce input; acknowledge only the batch sent, retaining input arriving during a request. */
export function createPblActivity(send: () => Promise<boolean>, changed: () => void) {
  let version = 0,
    acknowledged = 0,
    sending = false;
  return {
    mark() {
      version++;
      changed();
    },
    async flush() {
      if (sending || version === acknowledged) return;
      sending = true;
      const batch = version;
      try {
        if (await send()) acknowledged = batch;
      } catch {
        /* A failed batch stays pending for the next heartbeat. */
      } finally {
        sending = false;
      }
    },
  };
}
