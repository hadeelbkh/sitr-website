"use client";

import Image from "next/image";
import type { ChangeEvent, FormEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

type Status = "idle" | "uploading" | "processing" | "success" | "error";

const POLL_INTERVAL_MS = 2000;
const MAX_POLLS = 45;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export default function Home() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const pollControllerRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const resetObjectUrl = (url: string | null) => {
    if (url) {
      URL.revokeObjectURL(url);
    }
  };

  useEffect(() => {
    return () => {
      resetObjectUrl(previewUrl);
    };
  }, [previewUrl]);

  useEffect(() => {
    return () => {
      resetObjectUrl(resultUrl);
    };
  }, [resultUrl]);

  useEffect(() => {
    return () => {
      pollControllerRef.current?.abort();
    };
  }, []);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    setErrorMessage(null);
    setStatus("idle");
    pollControllerRef.current?.abort();
    if (!file) {
      setSelectedFile(null);
      resetObjectUrl(previewUrl);
      setPreviewUrl(null);
      return;
    }

    resetObjectUrl(previewUrl);
    const nextPreviewUrl = URL.createObjectURL(file);
    setPreviewUrl(nextPreviewUrl);
    setSelectedFile(file);
    setResultUrl((prev) => {
      resetObjectUrl(prev);
      return null;
    });
  };

  const pollForResult = useCallback(async (taskId: string) => {
    const controller = new AbortController();
    pollControllerRef.current?.abort();
    pollControllerRef.current = controller;

    for (let attempt = 0; attempt < MAX_POLLS; attempt += 1) {
      if (controller.signal.aborted) {
        return;
      }

      try {
        const response = await fetch(`/api/result/${taskId}`, {
          method: "GET",
          cache: "no-store",
          signal: controller.signal,
        });

        if (response.status === 202) {
          if (controller.signal.aborted) {
            return;
          }
          await sleep(POLL_INTERVAL_MS);
          if (controller.signal.aborted) {
            return;
          }
          continue;
        }

        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          setErrorMessage(payload?.error || "Processing failed.");
          setStatus("error");
          return;
        }

        const contentType = response.headers.get("content-type") || "";

        if (contentType.includes("application/json")) {
          const payload = await response.json();
          setErrorMessage(payload?.error || "Processing failed.");
          setStatus("error");
          return;
        }

        const blob = await response.blob();
        if (!blob.size) {
          setErrorMessage("Received an empty file.");
          setStatus("error");
          return;
        }

        setResultUrl((prev) => {
          resetObjectUrl(prev);
          return URL.createObjectURL(blob);
        });
        setStatus("success");
        return;
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        console.error("Polling failed:", error);
        setErrorMessage("Lost connection to the processor.");
        setStatus("error");
        return;
      }

      if (attempt < MAX_POLLS - 1) {
        if (controller.signal.aborted) {
          return;
        }
        await sleep(POLL_INTERVAL_MS);
        if (controller.signal.aborted) {
          return;
        }
      }
    }

    if (!controller.signal.aborted) {
      setErrorMessage("Timed out while waiting for the model.");
      setStatus("error");
    }
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedFile) {
      setErrorMessage("Please choose an image before checking.");
      return;
    }

    setErrorMessage(null);
    setStatus("uploading");
    setResultUrl((prev) => {
      resetObjectUrl(prev);
      return null;
    });

    const formData = new FormData();
    formData.append("image", selectedFile);

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        body: formData,
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setErrorMessage(payload?.error || "Unable to contact the model.");
        setStatus("error");
        return;
      }

      if (!payload?.taskId) {
        setErrorMessage("Missing task information from the backend.");
        setStatus("error");
        return;
      }

      setStatus("processing");
      pollForResult(payload.taskId);
    } catch (error) {
      console.error("Upload failed:", error);
      setErrorMessage("Upload failed. Please try again.");
      setStatus("error");
    }
  };

  const handleReset = () => {
    setSelectedFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    resetObjectUrl(previewUrl);
    setPreviewUrl(null);
    setResultUrl((prev) => {
      resetObjectUrl(prev);
      return null;
    });
    setErrorMessage(null);
    setStatus("idle");
    pollControllerRef.current?.abort();
  };

  const statusCopy: Record<Status, string> = {
    idle: "Upload an image to start.",
    uploading: "Uploading photo...",
    processing: "Model is checking for hijab...",
    success: "Processing complete!",
    error: "Something went wrong.",
  };

  return (
    <div className="min-h-screen bg-slate-950 bg-grid-white/[0.02] py-12 text-white">
      <div className="mx-auto flex max-w-5xl flex-col gap-12 px-4 sm:px-6 lg:px-8">
        <header className="space-y-4 text-center">
          <p className="text-sm uppercase tracking-[0.3em] text-emerald-400">
            Hijab Compliance
          </p>
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
            Upload a photo, let the model handle the rest
          </h1>
          <p className="mx-auto max-w-2xl text-base text-slate-300 sm:text-lg">
            We detect faces, verify hijab usage with your Render-hosted model,
            and blur uncovered faces automatically. Nothing is stored—everything
            runs on-demand.
          </p>
        </header>

        <main className="grid gap-10 lg:grid-cols-[1.2fr_0.8fr]">
          <section className="rounded-3xl border border-white/10 bg-white/5 p-8 shadow-2xl shadow-emerald-500/10 backdrop-blur-xl">
            <form className="flex flex-col gap-6" onSubmit={handleSubmit}>
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium uppercase tracking-[0.25em] text-emerald-300">
                  Step 1 · Upload
                </label>
                <div className="rounded-2xl border border-dashed border-white/30 bg-black/20 p-6 text-center">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleFileChange}
                    className="w-full cursor-pointer rounded-full border border-white/20 bg-black/30 px-4 py-3 text-sm file:mr-4 file:rounded-full file:border-0 file:bg-emerald-500 file:px-5 file:py-2 file:text-sm file:font-semibold file:text-black hover:file:bg-emerald-400"
                  />
                  <p className="mt-3 text-sm text-slate-300">
                    Supported formats: JPG, PNG. Max 10 MB recommended.
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <label className="text-sm font-medium uppercase tracking-[0.25em] text-emerald-300">
                  Step 2 · Status
                </label>
                <div className="rounded-2xl border border-white/10 bg-black/30 p-5">
                  <p className="text-lg font-semibold text-white">
                    {statusCopy[status]}
                  </p>
                  {errorMessage ? (
                    <p className="mt-2 text-sm text-rose-300">{errorMessage}</p>
                  ) : (
                    <p className="mt-2 text-sm text-slate-400">
                      We send your cropped faces to the hijab model and blur the
                      result if needed.
                    </p>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  type="submit"
                  disabled={!selectedFile || status === "uploading" || status === "processing"}
                  className="flex-1 rounded-full bg-emerald-500 px-6 py-3 text-center text-sm font-semibold text-black transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-emerald-800/60 disabled:text-emerald-200"
                >
                  {status === "processing" || status === "uploading"
                    ? "Checking..."
                    : "Check photo"}
                </button>
                <button
                  type="button"
                  onClick={handleReset}
                  className="rounded-full border border-white/20 px-6 py-3 text-sm font-semibold text-white transition hover:border-white/50 hover:bg-white/10"
                >
                  Reset
                </button>
              </div>
            </form>
          </section>

          <section className="space-y-6">
            <div className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur-xl">
              <p className="text-sm uppercase tracking-[0.3em] text-emerald-300">
                Preview
              </p>
              <div className="mt-3 aspect-video w-full overflow-hidden rounded-2xl border border-white/10 bg-black/40">
                {previewUrl ? (
                  <div className="relative h-full w-full">
                    <Image
                      src={previewUrl}
                      alt="Uploaded preview"
                      fill
                      className="object-cover"
                      sizes="(max-width: 1024px) 100vw, 40vw"
                      unoptimized
                    />
                  </div>
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-slate-400">
                    No image selected yet
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur-xl">
              <div className="flex items-center justify-between">
                <p className="text-sm uppercase tracking-[0.3em] text-emerald-300">
                  Result
                </p>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    status === "success"
                      ? "bg-emerald-500/20 text-emerald-200"
                      : status === "error"
                        ? "bg-rose-500/20 text-rose-200"
                        : "bg-white/10 text-slate-200"
                  }`}
                >
                  {status.toUpperCase()}
                </span>
              </div>
              <div className="mt-3 aspect-video w-full overflow-hidden rounded-2xl border border-white/10 bg-black/40">
                {resultUrl ? (
                  <div className="relative h-full w-full">
                    <Image
                      src={resultUrl}
                      alt="Processed result"
                      fill
                      className="object-cover"
                      sizes="(max-width: 1024px) 100vw, 40vw"
                      unoptimized
                    />
                  </div>
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-slate-400">
                    {status === "processing"
                      ? "Working on it..."
                      : "Result will appear here"}
                  </div>
                )}
              </div>
              {resultUrl && (
                <a
                  href={resultUrl}
                  download="processed-photo.png"
                  className="mt-4 inline-flex w-full items-center justify-center rounded-full border border-emerald-400/60 px-6 py-3 text-sm font-semibold text-emerald-200 transition hover:bg-emerald-500/10"
                >
                  Download result
                </a>
              )}
            </div>

            <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-slate-900 to-slate-900/30 p-6 backdrop-blur">
              <h2 className="text-lg font-semibold text-white">
                How it works
              </h2>
              <ul className="mt-4 space-y-3 text-sm text-slate-300">
                <li>1. Detect faces using MTCNN.</li>
                <li>2. Send each crop to the hijab classifier on Render.</li>
                <li>3. Blur faces that are predicted as “No Hijab”.</li>
                <li>4. Return either the original or blurred photo.</li>
              </ul>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
