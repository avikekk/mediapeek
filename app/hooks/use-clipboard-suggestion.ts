import { useCallback, useEffect, useState } from 'react';

export function useClipboardSuggestion(currentUrl: string | undefined) {
  const [clipboardUrl, setClipboardUrl] = useState<string | null>(null);
  const [ignoredUrl, setIgnoredUrl] = useState<string | null>(null);

  const checkClipboard = useCallback(async () => {
    try {
      if (typeof document !== 'undefined' && !document.hasFocus()) return;

      const text = await navigator.clipboard.readText();
      if (!text) return;

      const trimmed = text.trim();
      if (
        trimmed.startsWith('http') &&
        trimmed !== currentUrl &&
        trimmed !== ignoredUrl &&
        trimmed.length < 2000
      ) {
        setClipboardUrl(trimmed);
      } else {
        setClipboardUrl(null);
      }
    } catch {
      // Silent catch: Permissions or focus issues are expected in some contexts.
    }
  }, [currentUrl, ignoredUrl]);

  /*
   * State to track if the browser has granted persistent permission (Chrome).
   * If true, we hide the manual 'Paste' button in the UI.
   */
  const [isPermissionGranted, setIsPermissionGranted] = useState(false);

  // Auto-check on focus for browsers that support strict permission queries (e.g. Chrome).
  useEffect(() => {
    const attemptAutoRead = async () => {
      try {
        if (
          typeof navigator !== 'undefined' &&
          navigator.permissions &&
          navigator.permissions.query
        ) {
          const result = await navigator.permissions.query({
            name: 'clipboard-read' as PermissionName,
          });

          if (result.state === 'granted') {
            setIsPermissionGranted(true);
            checkClipboard();
          } else if (result.state === 'prompt') {
            // Initially false, but we try to read. If user allows, next check might be granted.
            setIsPermissionGranted(false);
            checkClipboard();
          }

          // Listen for change (e.g. user revoked/granted elsewhere)
          result.onchange = () => {
            setIsPermissionGranted(result.state === 'granted');
          };
        }
      } catch {
        // Ignored
      }
    };

    if (typeof window !== 'undefined') {
      attemptAutoRead();
      window.addEventListener('focus', attemptAutoRead);
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', attemptAutoRead);
      }
    };
  }, [checkClipboard]);

  const ignoreClipboard = () => {
    if (clipboardUrl) {
      setIgnoredUrl(clipboardUrl);
      setClipboardUrl(null);
    }
  };

  const clearClipboard = () => {
    setClipboardUrl(null);
  };

  return {
    clipboardUrl,
    checkClipboard,
    ignoreClipboard,
    clearClipboard,
    isPermissionGranted,
  };
}
