import { NextRequest, NextResponse } from "next/server";

const backendBaseUrl = process.env.HIJAB_BACKEND_URL;

export const runtime = "nodejs";

interface RouteContext {
  params: {
    taskId: string;
  };
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  if (!backendBaseUrl) {
    return NextResponse.json(
      { error: "Missing HIJAB_BACKEND_URL configuration." },
      { status: 500 },
    );
  }

  const { taskId } = params;

  if (!taskId) {
    return NextResponse.json(
      { error: "Task ID is required." },
      { status: 400 },
    );
  }

  try {
    const response = await fetch(
      `${backendBaseUrl}/get_result/${encodeURIComponent(taskId)}`,
      {
        cache: "no-store",
      },
    );

    const contentType = response.headers.get("content-type") || "";

    if (response.status === 202) {
      const body = await response.json().catch(() => ({
        status: "processing",
      }));
      return NextResponse.json(body, { status: 202 });
    }

    if (!response.ok) {
      const errorBody = await response.json().catch(() => null);
      return NextResponse.json(
        { error: errorBody?.error || "Processing failed." },
        { status: response.status },
      );
    }

    if (contentType.includes("application/json")) {
      const payload = await response.json();
      return NextResponse.json(payload, { status: 200 });
    }

    const arrayBuffer = await response.arrayBuffer();
    return new NextResponse(arrayBuffer, {
      status: 200,
      headers: {
        "Content-Type": contentType || "image/png",
        "Content-Disposition": `inline; filename="result-${taskId}.png"`,
      },
    });
  } catch (error) {
    console.error("Failed to fetch task result:", error);
    return NextResponse.json(
      { error: "Unable to contact hijab processor backend." },
      { status: 502 },
    );
  }
}

