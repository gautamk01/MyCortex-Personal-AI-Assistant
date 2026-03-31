"use client";

import { Search } from "lucide-react";
import { useDebounce } from "@/lib/hooks";
import { useState, useEffect } from "react";

interface SearchBarProps {
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  debounceMs?: number;
}

export default function SearchBar({
  placeholder = "Search...",
  value,
  onChange,
  debounceMs = 300,
}: SearchBarProps) {
  const [input, setInput] = useState(value);
  const debounced = useDebounce(input, debounceMs);

  useEffect(() => {
    onChange(debounced);
  }, [debounced, onChange]);

  useEffect(() => {
    setInput(value);
  }, [value]);

  return (
    <div className="search-bar">
      <Search size={16} className="search-bar-icon" />
      <input
        type="text"
        className="search-bar-input"
        placeholder={placeholder}
        value={input}
        onChange={(e) => setInput(e.target.value)}
      />
    </div>
  );
}
