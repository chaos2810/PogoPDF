import { stat } from "node:fs/promises";
import { ViewMetadataInputSchema } from "@pogopdf/contracts";
import type { RpcCtx } from "../../rpc/dispatcher";
import { assertNotCancelled } from "../organize/organize";
import { loadPdf } from "../pdfdoc";

export type MetadataData = {
  title: string | null;
  author: string | null;
  subject: string | null;
  keywords: string | null;
  creator: string | null;
  producer: string | null;
  creationDate: string | null;
  modificationDate: string | null;
  pageCount: number;
  fileSizeBytes: number;
};

export async function runViewMetadata(
  input: unknown,
  ctx: RpcCtx,
  _outDir: string
): Promise<MetadataData> {
  const { filePath } = ViewMetadataInputSchema.parse(input);
  assertNotCancelled(ctx);

  const doc = await loadPdf(filePath, { updateMetadata: false });
  const { size } = await stat(filePath);
  const iso = (d: Date | undefined) => d?.toISOString() ?? null;

  return {
    title: doc.getTitle() ?? null,
    author: doc.getAuthor() ?? null,
    subject: doc.getSubject() ?? null,
    keywords: doc.getKeywords() ?? null,
    creator: doc.getCreator() ?? null,
    producer: doc.getProducer() ?? null,
    creationDate: iso(doc.getCreationDate()),
    modificationDate: iso(doc.getModificationDate()),
    pageCount: doc.getPageCount(),
    fileSizeBytes: size,
  };
}
