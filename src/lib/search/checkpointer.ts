import { MemorySaver } from '@langchain/langgraph';

// In-memory checkpointer for development. Threads persist within the process
// lifecycle, enabling conversation continuity and HITL resume within a session.
// For production persistence, swap with a SQLite-backed checkpointer.
export const checkpointer = new MemorySaver();
