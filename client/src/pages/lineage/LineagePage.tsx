import { useEffect } from "react";
import { useLocation } from "wouter";

export default function LineagePage() {
  const [, setLocation] = useLocation();

  useEffect(() => {
    setLocation("/debug/lineage");
  }, [setLocation]);

  return null;
}
