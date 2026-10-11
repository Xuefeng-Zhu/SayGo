import type { Config } from "tailwindcss";
export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#242b26",
        paper: "#f7f4eb",
        accent: "#b94d21",
        leaf: "#536851",
      },
    },
  },
  plugins: [],
} satisfies Config;
