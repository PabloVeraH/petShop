"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

interface BarcodeScannerProps {
  onDetected: (barcode: string) => void;
  onClose: () => void;
}

declare global {
  interface Window {
    BarcodeDetector?: new (opts: { formats: string[] }) => {
      detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue: string }>>;
    };
  }
}

export default function BarcodeScanner({ onDetected, onClose }: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  // Holds the ZXing stop handle so we can tear it down on unmount
  const zxingStopRef = useRef<{ stop: () => void } | null>(null);

  useEffect(() => {
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" } })
      .then((stream) => {
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
          setScanning(true);
        }
      })
      .catch(() => setError("No se pudo acceder a la cámara."));

    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      zxingStopRef.current?.stop();
    };
  }, []);

  useEffect(() => {
    if (!scanning || !videoRef.current || !streamRef.current) return;

    if (window.BarcodeDetector) {
      // Native path — Chrome Android, Edge with Shape Detection API
      const detector = new window.BarcodeDetector({
        formats: ["ean_13", "ean_8", "code_128", "code_39", "upc_a", "upc_e"],
      });

      const scan = async () => {
        if (!videoRef.current || videoRef.current.readyState < 2) {
          rafRef.current = requestAnimationFrame(scan);
          return;
        }
        try {
          const barcodes = await detector.detect(videoRef.current);
          if (barcodes.length > 0) {
            onDetected(barcodes[0].rawValue);
            return;
          }
        } catch {
          // no barcode in frame — continue
        }
        rafRef.current = requestAnimationFrame(scan);
      };

      rafRef.current = requestAnimationFrame(scan);
      return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
    }

    // JS fallback — desktop Chrome, Firefox, Safari (loaded lazily to avoid bundle bloat)
    const stream = streamRef.current;
    const videoEl = videoRef.current;
    let stopped = false;

    import("@zxing/browser").then(({ BrowserMultiFormatReader }) => {
      if (stopped) return;
      const reader = new BrowserMultiFormatReader();
      reader
        .decodeFromStream(stream, videoEl, (result) => {
          if (result) onDetected(result.getText());
        })
        .then((controls) => {
          zxingStopRef.current = controls;
        })
        .catch(() => setError("No se pudo acceder a la cámara."));
    });

    return () => {
      stopped = true;
      zxingStopRef.current?.stop();
    };
  }, [scanning, onDetected]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogTitle>Escanear código de barras</DialogTitle>
        <div className="space-y-3">
          {error ? (
            <p className="text-sm text-red-500">{error}</p>
          ) : (
            <>
              <video
                ref={videoRef}
                className="w-full rounded-lg bg-black aspect-video object-cover"
                muted
                playsInline
              />
              <p className="text-xs text-gray-400 text-center">
                Apunta la cámara al código de barras del producto
              </p>
            </>
          )}
          <Button variant="outline" onClick={onClose} className="w-full">
            Cancelar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
