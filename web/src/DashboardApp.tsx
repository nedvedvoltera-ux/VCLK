import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { ActionIcon, Button, FileButton, Group, Modal, MultiSelect, Select, Stack, Switch, Text, Textarea, TextInput, Title, Tooltip } from "@mantine/core";
import { DateTimePicker, TimeInput } from "@mantine/dates";
import FullCalendar from "@fullcalendar/react";
import type { EventDropArg } from "@fullcalendar/core";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import { useToast } from "./ui/Toast";

type User = { id: string; email: string; displayName: string; role: "admin" | "user"; authSource: string; active: boolean };
type Recipient = { id: string; email: string; displayName: string };
type Participant = { email: string; display_name?: string; invite_status: string };
type Recurrence = "none" | "daily" | "weekly" | "monthly";
const RECURRENCE_OPTIONS: { value: Exclude<Recurrence, "none">; label: string }[] = [
  { value: "daily", label: "Каждый день" },
  { value: "weekly", label: "Каждую неделю" },
  { value: "monthly", label: "Каждый месяц" },
];
const recurrenceLabel = (recurrence: Recurrence | undefined) =>
  RECURRENCE_OPTIONS.find((option) => option.value === recurrence)?.label;
/** Calendar/list key: each occurrence of a series is unique, while the meeting id is shared. */
const meetingKey = (meeting: Meeting) => meeting.occurrence_key ?? meeting.id;

type Meeting = {
  id: string; room_id: string; title: string; description: string; starts_at: string; ends_at: string;
  timezone: string; status: "scheduled" | "cancelled"; organizer_name: string; organizer_id: string;
  recording_enabled: boolean; reminder_minutes: number | null; participants: Participant[];
  recurrence: Recurrence; series_starts_at?: string; series_ends_at?: string; occurrence_key?: string;
  attachments: { id: string; original_name: string; content_type: string; size_bytes: number; created_at: string }[];
};

const api = async <T,>(path: string, options: RequestInit = {}): Promise<T> => {
  const response = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(body.error || "Ошибка запроса");
  }
  return response.status === 204 ? (undefined as T) : response.json();
};

const dateTimeLocal = (date: Date) => {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
};

const URL_IN_TEXT = /(https?:\/\/[^\s<]+[^\s<.,;:!?)]|www\.[^\s<]+[^\s<.,;:!?)]|[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;

function renderLinkedText(text: string) {
  const parts = text.split(URL_IN_TEXT);
  return parts.map((part, index) => {
    if (!part) return null;
    if (/^https?:\/\//i.test(part)) {
      return <a key={`${part}-${index}`} href={part} target="_blank" rel="noopener noreferrer">{part}</a>;
    }
    if (/^www\./i.test(part)) {
      return <a key={`${part}-${index}`} href={`https://${part}`} target="_blank" rel="noopener noreferrer">{part}</a>;
    }
    if (/^[a-zA-Z0-9._%+-]+@/i.test(part)) {
      return <a key={`${part}-${index}`} href={`mailto:${part}`}>{part}</a>;
    }
    return <span key={`${index}-${part.slice(0, 12)}`}>{part}</span>;
  });
}

const blankMeeting = () => {
  const start = new Date(Date.now() + 60 * 60 * 1000);
  start.setMinutes(0, 0, 0);
  return {
    title: "", description: "", startsAt: dateTimeLocal(start), endsAt: dateTimeLocal(new Date(start.getTime() + 60 * 60 * 1000)),
    participants: "", recordingEnabled: false, reminderMinutes: "15", recurrence: "none" as Recurrence,
  };
};

const IconInfo = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" />
  </svg>
);

function Auth({ onReady }: { onReady: (user: User) => void }) {
  const [setup, setSetup] = useState<boolean | null>(null);
  const [freeMode, setFreeMode] = useState(false);
  const [ldap, setLdap] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    void api<{ setupRequired: boolean; freeMode?: boolean }>("/api/bootstrap").then((data) => {
      setSetup(data.setupRequired);
      setFreeMode(Boolean(data.freeMode));
    });
  }, []);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError("");
    try {
      const body = { email: form.get("email"), password: form.get("password"), displayName: form.get("displayName") };
      const response = setup
        ? await api<{ user: User }>("/api/setup", { method: "POST", body: JSON.stringify(body) })
        : await api<{ user: User }>("/api/auth/login", { method: "POST", body: JSON.stringify({ ...body, source: ldap ? "ldap" : "local" }) });
      onReady(response.user);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Не удалось выполнить вход"); }
  };
  return <main className="dashboard-auth">
    <form className="dashboard-card" onSubmit={submit}>
      <span className="eyebrow">VCLK</span><h1>{setup ? "Создание администратора" : "Вход в VCLK"}</h1>
      <p>{setup ? "Первый аккаунт получит полный доступ к пользователям, календарю и интеграциям." : "Войдите в корпоративную систему видеовстреч."}</p>
      {!setup && freeMode ? <p>Или <a href="/room">войдите в свободную комнату</a> без учётной записи.</p> : null}
      {setup && <label>Ваше имя<input required name="displayName" autoComplete="name" /></label>}
      <label>Корпоративный e-mail<input required name="email" type="email" autoComplete="username" /></label>
      <label>Пароль<input required name="password" type="password" minLength={10} autoComplete={setup ? "new-password" : "current-password"} /></label>
      {!setup && <label className="toggle-row"><input type="checkbox" checked={ldap} onChange={(e) => setLdap(e.target.checked)} /> Войти через AD/LDAP</label>}
      {error && <p className="form-error">{error}</p>}<button>{setup ? "Создать администратора" : "Войти"}</button>
    </form>
  </main>;
}

function InviteActivation({ token, onReady }: { token: string; onReady: (user: User) => void }) {
  const [invite, setInvite] = useState<{ email: string; title: string; startsAt: string } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    void api<{ invite: { email: string; title: string; startsAt: string } }>(`/api/invites/${encodeURIComponent(token)}`)
      .then((data) => setInvite(data.invite))
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Приглашение недоступно"));
  }, [token]);
  const activate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const response = await api<{ user: User; meetingId: string }>(`/api/invites/${encodeURIComponent(token)}/activate`, {
        method: "POST", body: JSON.stringify({ displayName: form.get("displayName"), password: form.get("password") }),
      });
      onReady(response.user);
      window.history.replaceState({}, "", `/room?meeting=${encodeURIComponent(response.meetingId)}`);
      window.location.reload();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Не удалось активировать приглашение"); }
  };
  return <main className="dashboard-auth"><form className="dashboard-card" onSubmit={activate}><span className="eyebrow">Приглашение VCLK</span><h1>{invite ? invite.title : "Проверяем приглашение…"}</h1>{invite && <p>Вы приглашены на {new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(new Date(invite.startsAt))}. Активируйте доступ для {invite.email}.</p>}<label>Ваше имя<input required name="displayName" autoComplete="name" /></label><label>Создайте пароль<input required name="password" type="password" minLength={10} autoComplete="new-password" /></label>{error && <p className="form-error">{error}</p>}<button disabled={!invite}>Активировать и подключиться</button></form></main>;
}

const ATTACHMENT_ACCEPT = ".pdf,.docx,.xlsx,.pptx,.txt,.csv,.png,.jpg,.jpeg";
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

const uploadMeetingFile = async (meetingId: string, file: File) => {
  const body = new FormData();
  body.set("file", file);
  body.set("humanConfirmed", "true");
  const response = await fetch(`/api/meetings/${meetingId}/attachments`, {
    method: "POST",
    credentials: "include",
    body,
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: "Не удалось загрузить файл" }));
    throw new Error(payload.error || `Не удалось загрузить «${file.name}»`);
  }
};

const IconPencil = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
);

const IconTrash = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6" /><path d="M14 11v6" />
  </svg>
);

const reminderLabel = (minutes: number | null) => {
  if (!minutes) return "Без напоминания";
  if (minutes === 15) return "За 15 минут";
  if (minutes === 30) return "За 30 минут";
  if (minutes === 60) return "За 1 час";
  return `За ${minutes} мин.`;
};

const formFromMeeting = (meeting: Meeting) => ({
  title: meeting.title,
  description: meeting.description,
  startsAt: dateTimeLocal(new Date(meeting.starts_at)),
  endsAt: dateTimeLocal(new Date(meeting.ends_at)),
  participants: meeting.participants.map((p) => p.email).join(", "),
  recordingEnabled: meeting.recording_enabled,
  reminderMinutes: String(meeting.reminder_minutes ?? 15),
  recurrence: (meeting.recurrence || "none") as Recurrence,
});

function MeetingEditor({
  initial,
  recipients,
  currentUser,
  onClose,
  onSaved,
}: {
  initial?: Meeting;
  recipients: Recipient[];
  currentUser: User;
  onClose: () => void;
  onSaved: () => void;
}) {
  const canManage = Boolean(initial && (currentUser.role === "admin" || initial.organizer_id === currentUser.id));
  const [mode, setMode] = useState<"view" | "edit">(initial ? "view" : "edit");
  const [form, setForm] = useState(() => (initial ? formFromMeeting(initial) : blankMeeting()));
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");
  const selectedEmails = new Set(form.participants.split(/[,;\n]/).map((email) => email.trim().toLowerCase()).filter(Boolean));
  const existingCount = initial?.attachments?.length || 0;
  const dateFmt = new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" });

  const addFiles = (files: File[] | null) => {
    if (!files?.length) return;
    const next: File[] = [];
    for (const file of files) {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        setError(`«${file.name}» больше 20 МБ`);
        return;
      }
      next.push(file);
    }
    setPendingFiles((current) => {
      const merged = [...current, ...next];
      if (existingCount + merged.length > 10) {
        setError("К встрече можно прикрепить не более 10 файлов");
        return current;
      }
      setError("");
      return merged;
    });
  };

  const cancelEdit = () => {
    if (!initial) {
      onClose();
      return;
    }
    setForm(formFromMeeting(initial));
    setPendingFiles([]);
    setError("");
    setMode("view");
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setSaving(true);
    try {
      let startsAt = new Date(form.startsAt);
      let endsAt = new Date(form.endsAt);
      if (initial?.series_starts_at && initial.series_ends_at) {
        // Editing one occurrence moves the whole series by the same shift.
        startsAt = new Date(new Date(initial.series_starts_at).getTime() + startsAt.getTime() - new Date(initial.starts_at).getTime());
        endsAt = new Date(new Date(initial.series_ends_at).getTime() + endsAt.getTime() - new Date(initial.ends_at).getTime());
      }
      const payload = {
        ...form,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        reminderMinutes: Number(form.reminderMinutes),
        participants: form.participants.split(/[,;\n]/).map((email) => ({ email: email.trim() })).filter(({ email }) => email),
      };
      const result = await api<{ meeting: Meeting }>(`/api/meetings${initial ? `/${initial.id}` : ""}`, {
        method: initial ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });
      const meetingId = result.meeting.id;
      for (let index = 0; index < pendingFiles.length; index += 1) {
        if (index > 0) await new Promise((resolve) => setTimeout(resolve, 3200));
        await uploadMeetingFile(meetingId, pendingFiles[index]);
      }
      if (!initial) {
        await Promise.all(
          payload.participants.map(({ email }: { email: string }) =>
            api(`/api/meetings/${meetingId}/invites`, { method: "POST", body: JSON.stringify({ email }) }),
          ),
        );
      }
      onSaved();
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  };

  const removeMeeting = async () => {
    if (!initial) return;
    setDeleting(true);
    setError("");
    try {
      await api(`/api/meetings/${initial.id}`, { method: "DELETE" });
      setConfirmDelete(false);
      onSaved();
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось удалить встречу");
    } finally {
      setDeleting(false);
    }
  };

  if (mode === "view" && initial) {
    return (
      <>
        <Modal
          opened
          onClose={onClose}
          size="lg"
          centered
          title={
            <Group justify="space-between" wrap="nowrap" style={{ width: "100%", paddingRight: 8 }}>
              <Title order={3} lineClamp={2} style={{ flex: 1 }}>{initial.title}</Title>
              {canManage ? (
                <Group gap={6} wrap="nowrap">
                  <Tooltip label="Редактировать">
                    <ActionIcon variant="default" size="lg" radius="md" aria-label="Редактировать" onClick={() => setMode("edit")}>
                      <IconPencil />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label="Удалить">
                    <ActionIcon variant="default" size="lg" radius="md" color="red" aria-label="Удалить" onClick={() => setConfirmDelete(true)}>
                      <IconTrash />
                    </ActionIcon>
                  </Tooltip>
                </Group>
              ) : null}
            </Group>
          }
        >
          <Stack gap="md">
            <div>
              <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Время</Text>
              <Text>{dateFmt.format(new Date(initial.starts_at))} — {dateFmt.format(new Date(initial.ends_at))}</Text>
              {recurrenceLabel(initial.recurrence) ? (
                <Text size="sm" c="dimmed">Повторяется: {recurrenceLabel(initial.recurrence)?.toLowerCase()} в то же время</Text>
              ) : null}
            </div>
            <div>
              <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Организатор</Text>
              <Text>{initial.organizer_name}</Text>
            </div>
            {initial.description?.trim() ? (
              <div>
                <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Описание</Text>
                <Text className="meeting-description" component="div">{renderLinkedText(initial.description.trim())}</Text>
              </div>
            ) : null}
            <div>
              <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Участники</Text>
              <Text>
                {initial.participants.length
                  ? initial.participants.map((p) => p.display_name || p.email).join(", ")
                  : "Пока никого не пригласили"}
              </Text>
            </div>
            {initial.attachments?.length ? (
              <div>
                <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Вложения</Text>
                <Stack gap={4} mt={4}>
                  {initial.attachments.map((attachment) => (
                    <Text key={attachment.id} size="sm" component="a" href={`/api/attachments/${attachment.id}`} target="_blank" rel="noreferrer" c="blue.3">
                      {attachment.original_name}
                    </Text>
                  ))}
                </Stack>
              </div>
            ) : null}
            <Group gap="xl">
              <div>
                <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Напоминание</Text>
                <Text>{reminderLabel(initial.reminder_minutes)}</Text>
              </div>
              <div>
                <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Запись</Text>
                <Text>{initial.recording_enabled ? "Включена" : "Выключена"}</Text>
              </div>
            </Group>
            {error ? <div className="form-error" role="alert">{error}</div> : null}
            <Group justify="space-between" mt="sm">
              <Button variant="default" onClick={onClose}>Закрыть</Button>
              <Group>
                {canManage ? <Button variant="light" onClick={() => setMode("edit")}>Изменить</Button> : null}
                <Button onClick={() => window.location.assign(`/room?meeting=${encodeURIComponent(initial.id)}`)}>Подключиться</Button>
              </Group>
            </Group>
          </Stack>
        </Modal>
        <AlertDialog.Root open={confirmDelete} onOpenChange={setConfirmDelete}>
          <AlertDialog.Portal>
            <AlertDialog.Overlay className="radix-overlay" />
            <AlertDialog.Content className="radix-dialog compact">
              <AlertDialog.Title>Удалить встречу?</AlertDialog.Title>
              <AlertDialog.Description>
                «{initial.title}» будет отменена и исчезнет из календаря. Участники больше не смогут к ней подключиться.
                {initial.recurrence !== "none" ? " Будет удалена вся серия повторяющихся встреч." : ""}
              </AlertDialog.Description>
              <div className="modal-actions">
                <AlertDialog.Cancel className="secondary-btn" disabled={deleting}>Отмена</AlertDialog.Cancel>
                <AlertDialog.Action className="destructive-btn" disabled={deleting} onClick={(event) => { event.preventDefault(); void removeMeeting(); }}>
                  {deleting ? "Удаление…" : "Удалить"}
                </AlertDialog.Action>
              </div>
            </AlertDialog.Content>
          </AlertDialog.Portal>
        </AlertDialog.Root>
      </>
    );
  }

  return (
    <Modal
      opened
      onClose={onClose}
      size="lg"
      title={<Title order={2}>{initial ? "Изменить встречу" : "Запланировать встречу"}</Title>}
      centered
    >
      <form onSubmit={save}>
        <Stack gap="md">
          <TextInput label="Тема встречи" value={form.title} onChange={(e) => setForm({ ...form, title: e.currentTarget.value })} required maxLength={160} />
          <Textarea label="Описание" value={form.description} onChange={(e) => setForm({ ...form, description: e.currentTarget.value })} minRows={3} />
          <Group grow align="flex-start">
            <DateTimePicker
              label="Начало"
              value={form.startsAt}
              onChange={(value) => value && setForm({ ...form, startsAt: value, endsAt: `${value.slice(0, 10)}T${form.endsAt.split("T")[1] || "10:00"}` })}
              timePickerProps={{ withDropdown: true }}
            />
            <TimeInput
              label="Время окончания"
              value={form.endsAt.split("T")[1]?.slice(0, 5) || ""}
              onChange={(event) => setForm({ ...form, endsAt: `${form.startsAt.slice(0, 10)}T${event.currentTarget.value}` })}
              withSeconds={false}
              required
            />
          </Group>
          <Group grow align="flex-start">
            <Switch
              mt={form.recurrence !== "none" ? "xl" : 0}
              label="Повторяющаяся встреча"
              description={initial?.series_starts_at ? "Изменения применятся ко всей серии" : undefined}
              checked={form.recurrence !== "none"}
              onChange={(event) => setForm({ ...form, recurrence: event.currentTarget.checked ? "weekly" : "none" })}
            />
            {form.recurrence !== "none" ? (
              <Select
                label="Период"
                description="В то же время, что и эта встреча"
                allowDeselect={false}
                data={RECURRENCE_OPTIONS}
                value={form.recurrence}
                onChange={(value) => value && setForm({ ...form, recurrence: value as Recurrence })}
              />
            ) : null}
          </Group>
          <MultiSelect
            label="Участники"
            description="Выберите зарегистрированных пользователей"
            searchable
            data={recipients.map((recipient) => ({ value: recipient.email, label: `${recipient.displayName} — ${recipient.email}` }))}
            value={[...selectedEmails]}
            onChange={(value) => setForm({ ...form, participants: value.join(", ") })}
          />
          <Stack gap="xs">
            <Text size="sm" fw={500}>Вложения</Text>
            <Text size="xs" c="dimmed">PDF, Office, TXT/CSV, PNG/JPEG — до 20 МБ, не более 10 файлов на встречу.</Text>
            {initial?.attachments?.length ? (
              <Stack gap={4}>
                {initial.attachments.map((attachment) => (
                  <Text key={attachment.id} size="sm" component="a" href={`/api/attachments/${attachment.id}`} target="_blank" rel="noreferrer" c="blue.3">
                    {attachment.original_name}
                  </Text>
                ))}
              </Stack>
            ) : null}
            {pendingFiles.length ? (
              <Stack gap={4}>
                {pendingFiles.map((file, index) => (
                  <Group key={`${file.name}-${file.size}-${index}`} justify="space-between" gap="xs">
                    <Text size="sm">{file.name} <Text span c="dimmed">({(file.size / 1024 / 1024).toFixed(1)} МБ)</Text></Text>
                    <Button type="button" variant="subtle" size="compact-xs" onClick={() => setPendingFiles((current) => current.filter((_, i) => i !== index))}>Убрать</Button>
                  </Group>
                ))}
              </Stack>
            ) : null}
            <FileButton onChange={(file) => addFiles(file ? [file] : null)} accept={ATTACHMENT_ACCEPT}>
              {(props) => <Button {...props} type="button" variant="light">Прикрепить файл</Button>}
            </FileButton>
          </Stack>
          <Group grow align="center">
            <Select
              label="Напоминание"
              data={[
                { value: "0", label: "Без напоминания" },
                { value: "15", label: "За 15 минут" },
                { value: "30", label: "За 30 минут" },
                { value: "60", label: "За 1 час" },
              ]}
              value={form.reminderMinutes}
              onChange={(value) => setForm({ ...form, reminderMinutes: value || "0" })}
            />
            <Switch
              mt="xl"
              label="Записывать встречу"
              checked={form.recordingEnabled}
              onChange={(event) => setForm({ ...form, recordingEnabled: event.currentTarget.checked })}
            />
          </Group>
          {error ? <div className="form-error" role="alert">{error}</div> : null}
          <Group justify="flex-end">
            <Button variant="default" type="button" onClick={cancelEdit} disabled={saving}>{initial ? "К просмотру" : "Отмена"}</Button>
            <Button type="submit" loading={saving}>{initial ? "Сохранить" : "Создать и пригласить"}</Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

function DragConfirm({ change, onCancel, onConfirm }: { change: { meeting: Meeting; start: Date; end: Date; revert: () => void }; onCancel: () => void; onConfirm: () => void }) {
  const format = new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" });
  return <AlertDialog.Root open><AlertDialog.Portal><AlertDialog.Overlay className="radix-overlay" /><AlertDialog.Content className="radix-dialog compact"><span className="eyebrow">Подтверждение переноса</span><AlertDialog.Title>Перенести «{change.meeting.title}»?</AlertDialog.Title><AlertDialog.Description asChild><dl className="time-change"><dt>Было</dt><dd>{format.format(new Date(change.meeting.starts_at))} — {format.format(new Date(change.meeting.ends_at))}</dd><dt>Станет</dt><dd>{format.format(change.start)} — {format.format(change.end)}</dd></dl></AlertDialog.Description><div className="modal-actions"><AlertDialog.Cancel className="secondary-btn" onClick={() => { change.revert(); onCancel(); }}>Отмена</AlertDialog.Cancel><AlertDialog.Action onClick={onConfirm}>Подтвердить перенос</AlertDialog.Action></div></AlertDialog.Content></AlertDialog.Portal></AlertDialog.Root>;
}

function Settings({ kind }: { kind: "ldap" | "smtp" }) {
  const [settings, setSettings] = useState<Record<string, string | boolean>>({});
  const [notice, setNotice] = useState("");
  const fields = kind === "ldap"
    ? [["url", "LDAP URL", "ldaps://ad.company.local:636"], ["baseDn", "Base DN", "DC=company,DC=local"], ["loginAttribute", "Атрибут входа", "userPrincipalName"], ["adminGroup", "Группа администраторов", "CN=VCLK-Admins,OU=Groups,DC=company,DC=local"], ["bindDn", "Bind DN", "CN=svc-vclk,OU=Service,DC=company,DC=local"], ["bindPassword", "Пароль Bind", ""]]
    : [["host", "SMTP сервер", "smtp.company.local"], ["port", "Порт", "587"], ["from", "Адрес отправителя", "vclk@company.ru"], ["user", "SMTP пользователь", ""], ["password", "SMTP пароль", ""]];
  useEffect(() => { void api<{ settings: Record<string, string | boolean> }>(`/api/settings/${kind}`).then((data) => setSettings(data.settings)); }, [kind]);
  const save = async (event: FormEvent) => { event.preventDefault(); await api(`/api/settings/${kind}`, { method: "PUT", body: JSON.stringify({ settings }) }); setNotice("Настройки сохранены."); };
  const test = async () => { try { await api("/api/settings/smtp/test", { method: "POST", body: JSON.stringify({}) }); setNotice("Тестовое письмо отправлено."); } catch (caught) { setNotice(caught instanceof Error ? caught.message : "Ошибка теста"); } };
  return <section className="settings-panel"><div><span className="eyebrow">Интеграции</span><h2>{kind === "ldap" ? "Active Directory / LDAP" : "Корпоративная почта SMTP"}</h2><p>{kind === "ldap" ? "Параметры каталога вводятся здесь. Bind-пароль зашифрован и не показывается повторно." : "Приглашения отправляются с .ics-файлом для Outlook."}</p></div><form onSubmit={save}>{fields.map(([key, label, placeholder]) => <label key={key}>{label}<input type={/password/.test(key) ? "password" : "text"} value={String(settings[key] === true ? "" : settings[key] || "")} placeholder={placeholder} onChange={(e) => setSettings({ ...settings, [key]: e.target.value })} /></label>)}<div className="modal-actions"><button>Сохранить</button>{kind === "smtp" && <button type="button" className="secondary-btn" onClick={test}>Тестировать</button>}</div>{notice && <p className="form-notice">{notice}</p>}</form></section>;
}

function SystemSettings({ onSaved }: { onSaved?: (modes: { freeMode: boolean; calendarMode: boolean }) => void }) {
  const [freeMode, setFreeMode] = useState(false);
  const [calendarMode, setCalendarMode] = useState(true);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    void api<{ settings: { freeMode?: boolean; calendarMode?: boolean } }>("/api/settings/system").then((data) => {
      setFreeMode(Boolean(data.settings.freeMode));
      setCalendarMode(data.settings.calendarMode !== false);
    });
  }, []);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await api<{ settings: { freeMode: boolean; calendarMode: boolean } }>("/api/settings/system", {
        method: "PUT",
        body: JSON.stringify({ settings: { freeMode, calendarMode } }),
      });
      setFreeMode(response.settings.freeMode);
      setCalendarMode(response.settings.calendarMode);
      onSaved?.(response.settings);
      setNotice("Настройки режима сохранены.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="settings-panel">
      <div>
        <span className="eyebrow">Система</span>
        <h2>Режим работы VCLK</h2>
        <p>Выберите, как пользователи и гости могут создавать и открывать комнаты. Можно включить оба режима сразу.</p>
      </div>
      <form onSubmit={save}>
        <Stack gap="lg">
          <Group gap="sm" align="center" wrap="nowrap">
            <Switch
              label="Свободный режим"
              description="Произвольные комнаты по коду на странице входа"
              checked={freeMode}
              onChange={(event) => setFreeMode(event.currentTarget.checked)}
              style={{ flex: 1 }}
            />
            <Tooltip
              multiline
              w={300}
              withArrow
              label="Любой человек, включая гостей без входа, может создать или войти в комнату с произвольным именем (кодом) на странице /room. Удобно для быстрых созвонов без планирования в календаре."
            >
              <ActionIcon variant="subtle" color="gray" size="lg" radius="md" aria-label="Описание свободного режима" type="button">
                <IconInfo />
              </ActionIcon>
            </Tooltip>
          </Group>
          <Group gap="sm" align="center" wrap="nowrap">
            <Switch
              label="Создание встреч через календарь"
              description="Планирование встреч с участниками и приглашениями"
              checked={calendarMode}
              onChange={(event) => setCalendarMode(event.currentTarget.checked)}
              style={{ flex: 1 }}
            />
            <Tooltip
              multiline
              w={300}
              withArrow
              label="Пользователи планируют встречи в календаре VCLK: тема, время, участники, вложения и приглашения. Если свободный режим выключен, подключение возможно только к таким запланированным встречам."
            >
              <ActionIcon variant="subtle" color="gray" size="lg" radius="md" aria-label="Описание режима календаря" type="button">
                <IconInfo />
              </ActionIcon>
            </Tooltip>
          </Group>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          {notice ? <p className="form-notice">{notice}</p> : null}
          <div className="modal-actions"><button disabled={saving}>{saving ? "Сохранение…" : "Сохранить"}</button></div>
        </Stack>
      </form>
    </section>
  );
}

function AddUserDialog({ open, onOpenChange, onAdded }: { open: boolean; onOpenChange: (open: boolean) => void; onAdded: () => Promise<void> }) {
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const passwordsMatch = password.length > 0 && passwordConfirm.length > 0 && password === passwordConfirm;
  const passwordsMismatch = passwordConfirm.length > 0 && password !== passwordConfirm;
  const resetForm = () => {
    setError("");
    setPassword("");
    setPasswordConfirm("");
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (password.length < 10) {
      setError("Пароль должен содержать минимум 10 символов");
      return;
    }
    if (!passwordsMatch) {
      setError("Пароли не совпадают");
      return;
    }
    setSaving(true); setError("");
    try {
      await api("/api/users", {
        method: "POST",
        body: JSON.stringify({
          email: form.get("email"),
          displayName: form.get("displayName"),
          role: form.get("role"),
          password,
        }),
      });
      await onAdded();
      resetForm();
      onOpenChange(false);
      event.currentTarget.reset();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Не удалось добавить пользователя"); }
    finally { setSaving(false); }
  };
  return <Dialog.Root open={open} onOpenChange={(next) => { if (!next) resetForm(); onOpenChange(next); }}><Dialog.Portal><Dialog.Overlay className="radix-overlay" /><Dialog.Content className="radix-dialog">
    <div className="modal-head"><div><span className="eyebrow">Пользователи</span><Dialog.Title>Добавить пользователя</Dialog.Title></div><Dialog.Close className="icon-btn" aria-label="Закрыть">×</Dialog.Close></div>
    <Dialog.Description>Создайте локальную учётную запись с e-mail (login) и паролем. Пользователь сразу сможет войти в VCLK без приглашения.</Dialog.Description>
    <form onSubmit={submit} className="dialog-form">
      <label>Имя<input name="displayName" required autoComplete="name" placeholder="Иван Петров" /></label>
      <label>Login (e-mail)<input name="email" required type="email" autoComplete="username" placeholder="ivan@company.ru" /></label>
      <label>Пароль<input name="password" required type="password" minLength={10} autoComplete="new-password" placeholder="минимум 10 символов" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
      <label>Повтор пароля
        <input
          name="passwordConfirm"
          required
          type="password"
          minLength={10}
          autoComplete="new-password"
          value={passwordConfirm}
          onChange={(e) => setPasswordConfirm(e.target.value)}
          aria-invalid={passwordsMismatch || undefined}
          className={passwordsMismatch ? "input-invalid" : passwordsMatch ? "input-valid" : undefined}
        />
      </label>
      {passwordsMismatch ? <p className="form-error" role="status">Пароли не совпадают</p> : null}
      {passwordsMatch ? <p className="form-notice" role="status">Пароли совпадают</p> : null}
      <label>Роль<select name="role" defaultValue="user"><option value="user">Пользователь</option><option value="admin">Администратор</option></select></label>
      {error && <p className="form-error">{error}</p>}
      <div className="modal-actions"><Dialog.Close type="button" className="secondary-btn">Отмена</Dialog.Close><button disabled={saving || passwordsMismatch || (passwordConfirm.length > 0 && !passwordsMatch)}>{saving ? "Добавление…" : "Добавить"}</button></div>
    </form>
  </Dialog.Content></Dialog.Portal></Dialog.Root>;
}

function InviteDialog({ meeting, onOpenChange, onComplete }: { meeting: Meeting | null; onOpenChange: (open: boolean) => void; onComplete: (message: string, error?: boolean) => void }) {
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!meeting) return;
    const email = String(new FormData(event.currentTarget).get("email") || "");
    setSending(true); setError("");
    try {
      const response = await api<{ inviteUrl: string; warning?: string }>(`/api/meetings/${meeting.id}/invites`, { method: "POST", body: JSON.stringify({ email }) });
      await navigator.clipboard.writeText(response.inviteUrl);
      onComplete(response.warning || "Приглашение создано, ссылка скопирована в буфер обмена.");
      onOpenChange(false);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Не удалось создать приглашение"); }
    finally { setSending(false); }
  };
  return <Dialog.Root open={Boolean(meeting)} onOpenChange={onOpenChange}><Dialog.Portal><Dialog.Overlay className="radix-overlay" /><Dialog.Content className="radix-dialog">
    <div className="modal-head"><div><span className="eyebrow">Приглашение</span><Dialog.Title>{meeting?.title}</Dialog.Title></div><Dialog.Close className="icon-btn" aria-label="Закрыть">×</Dialog.Close></div><Dialog.Description>Укажите адрес участника. Ему будет отправлена ссылка и событие Outlook при настроенной почте.</Dialog.Description>
    <form className="dialog-form" onSubmit={submit}><label>E-mail получателя<input name="email" type="email" autoComplete="email" required autoFocus placeholder="user@company.ru" /></label>{error && <p className="form-error" role="alert">{error}</p>}<div className="modal-actions"><Dialog.Close type="button" className="secondary-btn">Отмена</Dialog.Close><button disabled={sending}>{sending ? "Отправка…" : "Создать приглашение"}</button></div></form>
  </Dialog.Content></Dialog.Portal></Dialog.Root>;
}

export default function DashboardApp() {
  const [user, setUser] = useState<User | null>(null); const [checking, setChecking] = useState(true);
  const [meetings, setMeetings] = useState<Meeting[]>([]); const [users, setUsers] = useState<User[]>([]);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [view, setView] = useState<"dashboard" | "calendar" | "users" | "ldap" | "smtp" | "system">("dashboard");
  const [modes, setModes] = useState({ freeMode: false, calendarMode: true });
  const [editor, setEditor] = useState<Meeting | "new" | null>(null); const [drag, setDrag] = useState<{ meeting: Meeting; start: Date; end: Date; revert: () => void } | null>(null); const [error, setError] = useState("");
  const [addUserOpen, setAddUserOpen] = useState(false);
  const [inviteMeeting, setInviteMeeting] = useState<Meeting | null>(null);
  const [deleteUser, setDeleteUser] = useState<User | null>(null);
  const calendarRef = useRef<FullCalendar | null>(null);
  const toast = useToast();
  const goCalendarView = (nextView: "dayGridMonth" | "timeGridWeek" | "timeGridDay") => {
    const api = calendarRef.current?.getApi();
    if (!api) return;
    if (nextView === "dayGridMonth") api.changeView(nextView);
    else api.changeView(nextView, new Date());
  };
  const loadMeetings = useCallback(async () => { try { setMeetings((await api<{ meetings: Meeting[] }>("/api/meetings?from=2020-01-01&to=2100-01-01")).meetings); } catch (caught) { setError(caught instanceof Error ? caught.message : "Не удалось загрузить встречи"); } }, []);
  const loadUsers = useCallback(async () => { if (user?.role === "admin") setUsers((await api<{ users: User[] }>("/api/users")).users); }, [user?.role]);
  useEffect(() => { void api<{ user: User }>("/api/auth/me").then((data) => setUser(data.user)).catch(() => undefined).finally(() => setChecking(false)); }, []);
  useEffect(() => {
    void api<{ freeMode?: boolean; calendarMode?: boolean }>("/api/bootstrap").then((data) => {
      setModes({ freeMode: Boolean(data.freeMode), calendarMode: data.calendarMode !== false });
    }).catch(() => undefined);
  }, []);
  useEffect(() => { if (user) { void loadMeetings(); void loadUsers(); void api<{ users: Recipient[] }>("/api/users/recipients").then((data) => setRecipients(data.users)); } }, [user, loadMeetings, loadUsers]);
  const logout = async () => { await api("/api/auth/logout", { method: "POST" }); setUser(null); };
  const openMeeting = (meeting: Meeting) => { window.location.assign(`/room?meeting=${encodeURIComponent(meeting.id)}`); };
  const uploadAttachment = (meeting: Meeting) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ATTACHMENT_ACCEPT;
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      if (file.size > MAX_ATTACHMENT_BYTES) {
        toast({ title: "Файл слишком большой", description: "Максимальный размер — 20 МБ.", tone: "error" });
        return;
      }
      try {
        await uploadMeetingFile(meeting.id, file);
        await loadMeetings();
        toast({ title: "Файл прикреплён" });
      } catch (caught) {
        toast({
          title: "Не удалось загрузить файл",
          description: caught instanceof Error ? caught.message : undefined,
          tone: "error",
        });
      }
    };
    input.click();
  };
  const invite = (meeting: Meeting) => setInviteMeeting(meeting);
  const inviteToken = window.location.pathname.match(/^\/invite\/([^/]+)$/)?.[1];
  if (checking) return <main className="dashboard-auth"><p>Загрузка VCLK…</p></main>;
  if (inviteToken) return <InviteActivation token={inviteToken} onReady={setUser} />;
  if (!user) return <Auth onReady={setUser} />;
  const seenSeries = new Set<string>();
  // A recurring series appears once in the list, with its nearest occurrence.
  const upcoming = meetings.filter((meeting) => {
    if (new Date(meeting.ends_at) < new Date() || meeting.status !== "scheduled" || seenSeries.has(meeting.id)) return false;
    seenSeries.add(meeting.id);
    return true;
  }).slice(0, 6);
  const eventTitle = (meeting: Meeting) => (meeting.recurrence !== "none" ? `↻ ${meeting.title}` : meeting.title);
  const findByKey = (key: string) => meetings.find((meeting) => meetingKey(meeting) === key) || null;
  const drop = (arg: EventDropArg) => {
    const meeting = findByKey(arg.event.id);
    if (meeting && meeting.recurrence === "none" && arg.event.start && arg.event.end && (user.role === "admin" || meeting.organizer_id === user.id)) {
      setDrag({ meeting, start: arg.event.start, end: arg.event.end, revert: arg.revert });
    } else {
      arg.revert();
    }
  };
  return <main className="dashboard-shell"><aside className="dashboard-nav"><a className="brand" href="/">VCLK<span>Планировщик</span></a><button className={view === "dashboard" ? "active" : ""} onClick={() => setView("dashboard")}>Обзор</button><button className={view === "calendar" ? "active" : ""} onClick={() => setView("calendar")}>Календарь</button>{user.role === "admin" && <><button className={view === "users" ? "active" : ""} onClick={() => setView("users")}>Пользователи</button><button className={view === "system" ? "active" : ""} onClick={() => setView("system")}>Режим</button><button className={view === "ldap" ? "active" : ""} onClick={() => setView("ldap")}>AD / LDAP</button><button className={view === "smtp" ? "active" : ""} onClick={() => setView("smtp")}>Почта</button></>}<div className="nav-bottom"><span>{user.displayName}<small>{user.role === "admin" ? "Администратор" : "Пользователь"}</small></span><button onClick={() => void logout()}>Выйти</button></div></aside>
    <section className="dashboard-content"><header className="dashboard-header"><div><span className="eyebrow">{view === "dashboard" ? "Рабочее пространство" : "Управление"}</span><h1>{view === "dashboard" ? `Добрый день, ${user.displayName}` : view === "calendar" ? "Календарь встреч" : view === "users" ? "Пользователи" : view === "system" ? "Режим работы" : "Интеграции"}</h1></div><div className="header-actions">{modes.freeMode ? <button type="button" className="secondary-btn" onClick={() => window.location.assign("/room")}>Свободная комната</button> : null}{modes.calendarMode ? <button type="button" onClick={() => setEditor("new")}>+ Запланировать встречу</button> : null}</div></header>{error && <p className="form-error">{error}</p>}
      {view === "dashboard" && <><section className="dashboard-stats"><article><span>Ближайшие встречи</span><strong>{upcoming.length}</strong><small>{user.role === "admin" ? "во всей организации" : "доступно вам"}</small></article><article><span>Сегодня</span><strong>{meetings.filter((m) => new Date(m.starts_at).toDateString() === new Date().toDateString()).length}</strong><small>встречи в календаре</small></article><article><span>Ваш доступ</span><strong>{user.role === "admin" ? "Admin" : "User"}</strong><small>роль в системе</small></article></section><section className="meeting-list"><div className="section-title"><h2>Ближайшие встречи</h2><button className="text-btn" onClick={() => setView("calendar")}>Открыть календарь</button></div>{upcoming.length ? upcoming.map((meeting) => <article className="meeting-row" key={meetingKey(meeting)}><time><b>{new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" }).format(new Date(meeting.starts_at))}</b><small>{new Intl.DateTimeFormat("ru-RU", { timeStyle: "short" }).format(new Date(meeting.starts_at))}</small></time><div><h3>{eventTitle(meeting)}</h3><p>{meeting.organizer_name} · {meeting.participants.length} участников{recurrenceLabel(meeting.recurrence) ? ` · ${recurrenceLabel(meeting.recurrence)?.toLowerCase()}` : ""}</p>{meeting.description?.trim() ? <p className="meeting-description">{renderLinkedText(meeting.description.trim())}</p> : null}{meeting.attachments?.length ? <p className="attachment-list">{meeting.attachments.map((attachment) => <a key={attachment.id} href={`/api/attachments/${attachment.id}`}>{attachment.original_name}</a>)}</p> : null}</div><div className="row-actions"><button className="secondary-btn" onClick={() => setEditor(meeting)}>Открыть</button><button className="secondary-btn" onClick={() => invite(meeting)}>Пригласить</button>{(user.role === "admin" || meeting.organizer_id === user.id) && <button className="secondary-btn" onClick={() => uploadAttachment(meeting)}>Файл</button>}<button onClick={() => openMeeting(meeting)}>Подключиться</button></div></article>) : <p className="empty-state">Запланированных встреч пока нет.</p>}</section><section className="calendar-panel dashboard-month-calendar"><div className="section-title"><h2>Календарь месяца</h2><button className="text-btn" onClick={() => setView("calendar")}>Развернуть</button></div><FullCalendar plugins={[dayGridPlugin, interactionPlugin]} initialView="dayGridMonth" firstDay={1} locale="ru" headerToolbar={{ left: "prev,next", center: "title", right: "today" }} events={meetings.filter((m) => m.status === "scheduled").map((m) => ({ id: meetingKey(m), title: eventTitle(m), start: m.starts_at, end: m.ends_at }))} eventClick={(event) => setEditor(findByKey(event.event.id))} height="auto" /></section></>}
      {view === "calendar" && <section className="calendar-panel"><FullCalendar ref={calendarRef} plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]} initialView="dayGridMonth" firstDay={1} locale="ru" headerToolbar={{ left: "prev,next today", center: "title", right: "monthNav,weekNav,dayNav" }} customButtons={{ monthNav: { text: "месяц", click: () => goCalendarView("dayGridMonth") }, weekNav: { text: "неделя", click: () => goCalendarView("timeGridWeek") }, dayNav: { text: "день", click: () => goCalendarView("timeGridDay") } }} editable events={meetings.filter((m) => m.status === "scheduled").map((m) => ({ id: meetingKey(m), title: eventTitle(m), start: m.starts_at, end: m.ends_at, editable: m.recurrence === "none" && (user.role === "admin" || m.organizer_id === user.id) }))} eventDrop={drop} eventClick={(event) => setEditor(findByKey(event.event.id))} datesSet={(arg) => { const root = document.querySelector<HTMLElement>(".calendar-panel .fc"); if (!root) return; for (const name of ["monthNav", "weekNav", "dayNav"]) root.querySelector(`.fc-${name}-button`)?.classList.remove("fc-button-active"); const active = arg.view.type === "timeGridWeek" ? "weekNav" : arg.view.type === "timeGridDay" ? "dayNav" : "monthNav"; root.querySelector(`.fc-${active}-button`)?.classList.add("fc-button-active"); }} height="auto" /></section>}
      {view === "users" && <section className="users-panel"><div className="section-title"><p>Пользователи получают доступ через приглашение или AD.</p><button onClick={() => setAddUserOpen(true)}>+ Пользователь</button></div><div className="data-table">{users.map((item) => <div key={item.id}><span><b>{item.displayName}</b><small>{item.email} · {item.authSource}</small></span><select value={item.role} onChange={async (e) => { await api(`/api/users/${item.id}`, { method: "PATCH", body: JSON.stringify({ role: e.target.value }) }); await loadUsers(); }}><option value="user">Пользователь</option><option value="admin">Администратор</option></select><button className="text-btn" onClick={() => setDeleteUser(item)}>Удалить</button></div>)}</div></section>}
      {view === "system" && <SystemSettings onSaved={setModes} />}{view === "ldap" && <Settings kind="ldap" />}{view === "smtp" && <Settings kind="smtp" />}
    </section><AddUserDialog open={addUserOpen} onOpenChange={setAddUserOpen} onAdded={async () => { await loadUsers(); setRecipients((await api<{ users: Recipient[] }>("/api/users/recipients")).users); }} /><InviteDialog meeting={inviteMeeting} onOpenChange={(open) => !open && setInviteMeeting(null)} onComplete={(message, error) => toast({ title: error ? "Ошибка приглашения" : "Приглашение готово", description: message, tone: error ? "error" : "success" })} /><AlertDialog.Root open={Boolean(deleteUser)} onOpenChange={(open) => !open && setDeleteUser(null)}><AlertDialog.Portal><AlertDialog.Overlay className="radix-overlay" /><AlertDialog.Content className="radix-dialog compact"><AlertDialog.Title>Деактивировать пользователя?</AlertDialog.Title><AlertDialog.Description>{deleteUser?.email} потеряет доступ к VCLK, но его данные останутся в истории встреч.</AlertDialog.Description><div className="modal-actions"><AlertDialog.Cancel className="secondary-btn">Отмена</AlertDialog.Cancel><AlertDialog.Action className="destructive-btn" onClick={async () => { if (!deleteUser) return; await api(`/api/users/${deleteUser.id}`, { method: "DELETE" }); await loadUsers(); setDeleteUser(null); toast({ title: "Пользователь деактивирован" }); }}>Деактивировать</AlertDialog.Action></div></AlertDialog.Content></AlertDialog.Portal></AlertDialog.Root>{editor && <MeetingEditor initial={editor === "new" ? undefined : editor} recipients={recipients} currentUser={user} onClose={() => setEditor(null)} onSaved={() => void loadMeetings()} />}{drag && <DragConfirm change={drag} onCancel={() => setDrag(null)} onConfirm={async () => { try { await api(`/api/meetings/${drag.meeting.id}`, { method: "PATCH", body: JSON.stringify({ startsAt: drag.start.toISOString(), endsAt: drag.end.toISOString() }) }); await loadMeetings(); } catch (caught) { drag.revert(); toast({ title: "Не удалось перенести", description: caught instanceof Error ? caught.message : undefined, tone: "error" }); } finally { setDrag(null); } }} />}</main>;
}
