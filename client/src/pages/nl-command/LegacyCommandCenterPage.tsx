import { useEffect } from "react";
import { useLocation } from "wouter";

export default function LegacyCommandCenterPage() {
  const [, setLocation] = useLocation();

  useEffect(() => {
    setLocation("/");
  }, [setLocation]);

  return null;
}
