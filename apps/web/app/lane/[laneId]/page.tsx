import { notFound } from "next/navigation";
import { LaneBoard } from "../../components/lane-board";
export default async function Page({
  params,
}: {
  params: Promise<{ laneId: string }>;
}) {
  const { laneId } = await params;
  if (laneId !== "lane-1") notFound();
  return <LaneBoard />;
}
