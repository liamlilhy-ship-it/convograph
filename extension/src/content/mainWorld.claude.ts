/**
 * claude.ai MAIN-world entry. Matched only on claude.ai in the manifest, so the
 * Claude refresh bridge (React fiber + TanStack Query poking) never loads on any
 * other site. The bridge self-registers its `cg-refresh-conversation` listener on
 * import.
 */
import '../platforms/claude/mainWorldBridge';
