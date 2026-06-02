const path = require("path");
const { v4: uuidv4 } = require("uuid");
const { supabase, isSupabaseConfigured } = require("./supabase");

const BUCKET = "uploads";
let bucketReady = false;

function usesRemoteStorage() {
  return isSupabaseConfigured();
}

async function ensureBucket() {
  if (bucketReady) return;
  const sb = supabase();
  const { data: buckets, error: listError } = await sb.storage.listBuckets();
  if (listError) throw listError;

  if (!buckets?.some((b) => b.name === BUCKET)) {
    const { error: createError } = await sb.storage.createBucket(BUCKET, {
      public: true,
      fileSizeLimit: 8 * 1024 * 1024,
    });
    if (createError && !/already exists/i.test(createError.message)) {
      throw createError;
    }
  }

  bucketReady = true;
}

async function uploadPublicImage(file, folder = "products") {
  await ensureBucket();
  const ext = path.extname(file.originalname) || ".jpg";
  const key = `${folder}/${uuidv4()}${ext}`;
  const body = file.buffer;
  if (!body) throw new Error("Missing upload data");

  const { error } = await supabase()
    .storage.from(BUCKET)
    .upload(key, body, {
      contentType: file.mimetype || "image/jpeg",
      upsert: false,
    });
  if (error) throw error;

  const { data } = supabase().storage.from(BUCKET).getPublicUrl(key);
  return data.publicUrl;
}

function getRemoteObjectKey(url) {
  if (!url) return null;
  const marker = `/storage/v1/object/public/${BUCKET}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  return decodeURIComponent(url.slice(idx + marker.length));
}

async function deleteRemoteUpload(url) {
  const key = getRemoteObjectKey(url);
  if (!key) return;
  await supabase().storage.from(BUCKET).remove([key]);
}

module.exports = {
  BUCKET,
  deleteRemoteUpload,
  uploadPublicImage,
  usesRemoteStorage,
};
