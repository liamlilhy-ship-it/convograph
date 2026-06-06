/**
 * ChatGPT MAIN-world entry. Matched only on ChatGPT hosts in the manifest, so the
 * Claude bridge never loads here (and this never loads on claude.ai).
 */
import '../platforms/chatgpt/mainWorldBridge';
