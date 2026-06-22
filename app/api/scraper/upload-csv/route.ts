import { writeFileSync } from "fs";
import { join } from "path";
import { NextResponse } from "next/server";
import { ensureDashboardDirs, parseCsv, uploadsDir, validateProfileRows } from "@/app/api/_lib/store";

export async function POST(request: Request) {
  ensureDashboardDirs();
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }
  const text = await file.text();
  const uploadId = `upload_${Date.now()}`;
  const path = join(uploadsDir, `${uploadId}.csv`);
  writeFileSync(path, text, "utf-8");
  const rows = validateProfileRows(parseCsv(text));
  return NextResponse.json({
    uploadId,
    filename: file.name,
    rows,
    validCount: rows.filter((row) => row.valid).length,
    invalidCount: rows.filter((row) => !row.valid).length
  });
}
