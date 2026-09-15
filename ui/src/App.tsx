import { LangProvider } from "./app/LangProvider";
import { ThemeProvider } from "./app/ThemeProvider";
import { Router } from "./app/router";

export default function App() {
  return (
    <LangProvider>
      <ThemeProvider>
        <Router />
      </ThemeProvider>
    </LangProvider>
  );
}
