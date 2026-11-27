import { Toaster } from "sonner";
import { ArticleList } from "./components/ArticleList";
import { EditorScreen } from "./components/EditorScreen";
import { ProjectList } from "./components/ProjectList";
import { useHash, useKeyboardInset } from "./lib/hooks";
import { parseRoute } from "./lib/route";

export function App() {
  const route = parseRoute(useHash());
  useKeyboardInset();
  return (
    <>
      {route.view === "projects" && <ProjectList />}
      {route.view === "articles" && <ArticleList key={route.project} project={route.project} />}
      {route.view === "edit" && <EditorScreen key={`${route.project}\n${route.article}`} route={route} />}
      <Toaster position="top-center" theme="system" closeButton />
    </>
  );
}
