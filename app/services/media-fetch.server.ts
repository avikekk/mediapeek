import {
  getEmulationHeaders,
  resolveGoogleDriveUrl,
  validateUrl,
} from '~/lib/server-utils';

export interface FetchDiagnostics {
  headRequestDurationMs: number;
  fetchRequestDurationMs: number;
  totalDurationMs: number;
  isGoogleDrive: boolean;
  resolvedFilename: string;
  responseStatus: number;
}

export interface MediaFetchResult {
  buffer: Uint8Array;
  filename: string;
  fileSize: number;
  diagnostics: FetchDiagnostics;
}

export async function fetchMediaChunk(
  initialUrl: string,
  chunkSize: number = 10 * 1024 * 1024,
): Promise<MediaFetchResult> {
  const tStart = performance.now();
  const diagnostics: Partial<FetchDiagnostics> = {};

  const { url: targetUrl, isGoogleDrive } = resolveGoogleDriveUrl(initialUrl);
  diagnostics.isGoogleDrive = isGoogleDrive;

  validateUrl(targetUrl);

  // 1. HEAD Request
  const tHead = performance.now();
  const headRes = await fetch(targetUrl, {
    method: 'HEAD',
    headers: getEmulationHeaders(),
    redirect: 'follow',
  });
  diagnostics.headRequestDurationMs = Math.round(performance.now() - tHead);

  // Check for HTML content (indicates a webpage, not a direct file link)
  const contentType = headRes.headers.get('content-type');
  if (contentType?.includes('text/html')) {
    // If it's Google Drive, it might be the rate-limit page
    if (isGoogleDrive) {
      throw new Error(
        'Google Drive file is rate-limited. Try again in 24 hours.',
      );
    }
    // Generic HTML response
    throw new Error(
      'URL links to a webpage, not a media file. Provide a direct link.',
    );
  }

  if (!headRes.ok) {
    if (headRes.status === 404) {
      throw new Error('Media file not found. Check the URL.');
    } else if (headRes.status === 403) {
      throw new Error(
        'Access denied. The link may have expired or requires authentication.',
      );
    } else {
      throw new Error(`Unable to access file (HTTP ${headRes.status}).`);
    }
  }

  const fileSize = parseInt(headRes.headers.get('content-length') || '0', 10);
  if (!fileSize) throw new Error('Could not determine file size');

  // 2. Determine Filename
  let filename = targetUrl;
  const contentDisposition = headRes.headers.get('content-disposition');
  if (contentDisposition) {
    const starMatch = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
    if (starMatch && starMatch[1]) {
      try {
        filename = decodeURIComponent(starMatch[1]);
      } catch {
        // failed to decode, keep original
      }
    } else {
      const normalMatch = contentDisposition.match(/filename="?([^";]+)"?/i);
      if (normalMatch && normalMatch[1]) {
        filename = normalMatch[1];
      }
    }
  }
  diagnostics.resolvedFilename = filename;

  // 3. Fetch Content Chunk
  const fetchEnd = Math.min(chunkSize - 1, fileSize - 1);

  const tFetch = performance.now();
  const response = await fetch(targetUrl, {
    headers: getEmulationHeaders(`bytes=0-${fetchEnd}`),
    redirect: 'follow',
  });
  diagnostics.fetchRequestDurationMs = Math.round(performance.now() - tFetch);
  diagnostics.responseStatus = response.status;

  const SAFE_LIMIT = 10 * 1024 * 1024; // 10MB "Eco Mode" limit
  const tempBuffer = new Uint8Array(SAFE_LIMIT); // Pre-allocate: Zero GC overhead
  let offset = 0;

  const reader = response.body?.getReader();
  if (!reader) throw new Error('Failed to retrieve response body stream');

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const spaceLeft = SAFE_LIMIT - offset;

      if (value.byteLength > spaceLeft) {
        // Buffer full: Copy what fits, then stop.
        tempBuffer.set(value.subarray(0, spaceLeft), offset);
        offset += spaceLeft;
        await reader.cancel();
        break;
      } else {
        tempBuffer.set(value, offset);
        offset += value.byteLength;
      }
    }
  } catch (err) {
    // Stream failed, propagate error to be caught by main handler
    throw new Error(
      `Stream reading failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Create a view of the actual data we read (no copy)
  const fileBuffer = tempBuffer.subarray(0, offset);

  diagnostics.totalDurationMs = Math.round(performance.now() - tStart);

  return {
    buffer: fileBuffer,
    filename,
    fileSize,
    diagnostics: diagnostics as FetchDiagnostics,
  };
}
