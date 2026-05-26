import { createClient } from "@/lib/supabase-server";
import { documentBucketForEntity } from "@/lib/transaction-document-config";
import { getTransactionDocumentById } from "@/lib/transaction-documents";

type DocumentDownloadRouteProps = {
  params: Promise<{ documentId: string }>;
};

export async function GET(request: Request, { params }: DocumentDownloadRouteProps) {
  const { documentId } = await params;
  const document = await getTransactionDocumentById(documentId);
  if (!document) return new Response("Document not found.", { status: 404 });

  const download = new URL(request.url).searchParams.has("download");
  const supabase = await createClient();
  const bucketName = documentBucketForEntity(document.entity_name);
  const { data, error } = await supabase.storage
    .from(bucketName)
    .createSignedUrl(document.file_path, 60, download ? { download: document.file_name } : undefined);

  if (error || !data?.signedUrl) {
    return new Response("Document link could not be created.", { status: 403 });
  }

  return Response.redirect(data.signedUrl, 302);
}
