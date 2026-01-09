import { useRef, useState } from 'react';
import { toast } from 'sonner';

import { safeClipboardWrite } from '../lib/clipboard';
import { uploadToPrivateBin } from '../lib/privatebin';
import { useHapticFeedback } from './use-haptic';

interface UseMediaActionsProps {
  data: Record<string, string>;
  url: string;
}

export function useMediaActions({ data, url }: UseMediaActionsProps) {
  const fetchedData = useRef<Record<string, string>>({});
  const { triggerSuccess } = useHapticFeedback();
  const [isSharing, setIsSharing] = useState(false);

  const fetchContent = async (format: string, label: string) => {
    let content: string | undefined =
      data[format] || fetchedData.current[format];

    if (!content) {
      const toastId = toast.loading(`Generating ${label}...`);
      try {
        const response = await fetch(
          `/resource/analyze?url=${encodeURIComponent(url)}&format=${format}`,
        );
        if (!response.ok) throw new Error('Failed to generate format');
        const json = (await response.json()) as {
          results?: Record<string, string>;
        };
        content = json.results?.[format];
        if (!content) throw new Error('No content returned');

        fetchedData.current[format] = content as string;
        toast.dismiss(toastId);
      } catch (err) {
        console.error(err);
        toast.error(`Failed to generate ${label}`, { id: toastId });
        return null;
      }
    }
    return content;
  };

  const handleCopy = (format: string, label: string) => {
    const contentPromise = fetchContent(format, label).then((content) => {
      if (!content) {
        if (content === undefined) toast.error(`No ${label} data found.`);
        throw new Error('No content found');
      }
      return content;
    });

    safeClipboardWrite(
      contentPromise,
      () => {
        triggerSuccess();
        toast.success('Copied to clipboard', {
          description: `${label} format copied successfully.`,
          duration: 2000,
        });
      },
      (err: unknown) => {
        console.error('Failed to copy', err);
        // If the error is 'No content found', the toast is already shown right above
        // or inside fetchContent's catch block
      },
    );
  };

  const handleShare = (
    format: string,
    label: string,
    onSuccess?: (url: string) => void,
  ) => {
    const urlPromise = (async () => {
      const content = await fetchContent(format, label);
      if (!content) {
        if (content === undefined) toast.error(`No ${label} data found.`);
        throw new Error('No content found');
      }

      const toastId = toast.loading(`Encrypting & Uploading ${label}...`);
      setIsSharing(true);

      try {
        const { url: newUrl } = await uploadToPrivateBin(content);
        toast.dismiss(toastId);
        return newUrl;
      } catch (err) {
        console.error('PrivateBin upload failed:', err);
        toast.error('Upload Failed', {
          id: toastId,
          description: 'Could not upload to PrivateBin. Please try again.',
        });
        throw err;
      } finally {
        setIsSharing(false);
      }
    })();

    // 1. Trigger Clipboard Write (Sync start with Promise)
    safeClipboardWrite(
      urlPromise,
      () => {
        triggerSuccess();
        // The URL is now available. We can call the callback if provided.
        // But safeClipboardWrite callback doesn't pass the resolved text back to us easily
        // unless we tap into the promise again.
        // Actually, we can just attach to urlPromise.
        urlPromise.then((url) => {
          if (onSuccess) onSuccess(url);
          toast.success('Link Copied', {
            description: `Secure ${label} link copied. Click the button to open.`,
            duration: 4000,
          });
        });
      },
      () => {
        // Errors handled in promise or toast
      },
    );
  };

  return { handleCopy, handleShare, isSharing };
}
