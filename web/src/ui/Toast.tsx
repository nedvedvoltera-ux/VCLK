import { notifications } from "@mantine/notifications";

type Notice = { title: string; description?: string; tone?: "success" | "error" };
export const useToast = () => (notice: Notice) =>
  notifications.show({
    title: notice.title,
    message: notice.description,
    color: notice.tone === "error" ? "red" : "blue",
    autoClose: 4000,
  });
