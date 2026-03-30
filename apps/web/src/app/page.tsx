import { Dashboard } from "../components/dashboard";
import { fetchDisputes, fetchTasks } from "../lib/api";

export default async function HomePage() {
  const [tasks, disputes] = await Promise.all([fetchTasks(), fetchDisputes()]);
  return <Dashboard tasks={tasks} disputes={disputes} />;
}

