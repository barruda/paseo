const LOOPBACK_REMOTE_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

export function isLoopbackRemoteAddress(remoteAddress: string | undefined): boolean {
  return remoteAddress !== undefined && LOOPBACK_REMOTE_ADDRESSES.has(remoteAddress);
}
