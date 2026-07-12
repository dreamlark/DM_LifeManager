import type { IngestNoteInput } from '@dm-life/shared';
import { ingestNote } from '../modules/notes/command';

/**
 * KnowledgeBackend 端口 + 本地适配器 stub。
 * 接口已就位（ingest / semanticSearch / ask），真实向量检索与问答是 P1 工作。
 */
export interface KnowledgeBackendPort {
  ingest(input: IngestNoteInput): Promise<string>;
  semanticSearch(query: string, k?: number): Promise<string[]>;
  ask(question: string): Promise<string>;
}

class LocalAdapter implements KnowledgeBackendPort {
  async ingest(input: IngestNoteInput): Promise<string> {
    return ingestNote(input);
  }
  async semanticSearch(_query: string, _k = 5): Promise<string[]> {
    // P0 stub：真实向量检索（sqlite-vec / LanceDB）P1 接入
    return [];
  }
  async ask(_question: string): Promise<string> {
    return '（向量检索与问答尚未启用，P1 实现）';
  }
}

export const knowledgeBackend: KnowledgeBackendPort = new LocalAdapter();
