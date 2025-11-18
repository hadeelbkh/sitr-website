import { NextRequest, NextResponse } from "next/server";
import { Buffer } from "node:buffer";

const backendBaseUrl = process.env.HIJAB_BACKEND_URL;

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!backendBaseUrl) {
    return NextResponse.json(
      { error: "Missing HIJAB_BACKEND_URL configuration." },
      { status: 500 },
    );
  }

  const formData = await request.formData();
  const file = formData.get("image");

  if (!file || !(file instanceof File)) {
    return NextResponse.json(
      { error: "Image file is required." },
      { status: 400 },
    );
  }

  const fileName = file.name || `upload-${Date.now()}.png`;
  const contentType = file.type || "application/octet-stream";
  const buffer = Buffer.from(await file.arrayBuffer());
  const proxyFormData = new FormData();
  proxyFormData.append(
    "image",
    new Blob([buffer], { type: contentType }),
    fileName,
  );

  try {
    const response = await fetch(`${backendBaseUrl}/process_image`, {
      method: "POST",
      body: proxyFormData,
    });

    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      return NextResponse.json(
        { error: payload?.error || "Failed to start processing." },
        { status: response.status },
      );
    }

    if (!payload?.task_id) {
      return NextResponse.json(
        { error: "Backend did not return a task_id." },
        { status: 502 },
      );
    }

    return NextResponse.json(
      { taskId: payload.task_id },
      { status: 202 },
    );
  } catch (error) {
    console.error("Failed to reach hijab backend:", error);
    return NextResponse.json(
      { error: "Unable to reach hijab processor backend." },
      { status: 502 },
    );
  }
}

