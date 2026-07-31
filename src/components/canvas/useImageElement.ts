import { useEffect, useState } from "react";

export const useImageElement = (source: string) => {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!source) {
      setImage(null);
      return;
    }

    let active = true;
    const element = new window.Image();
    element.onload = () => {
      if (!active) return;
      setImage(element);
      setFailed(false);
    };
    element.onerror = () => {
      if (!active) return;
      setFailed(true);
      setImage(null);
    };
    element.src = source;

    return () => {
      active = false;
    };
  }, [source]);

  return { image, failed };
};
