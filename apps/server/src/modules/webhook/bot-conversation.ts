import type { CaseCategory, CreateCaseInput } from '@domdelo/contracts';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';

import type { AuthenticatedActor } from '../../types.js';
import type { BotButton, BotNotifier } from '../../services/max-notifier.js';

type MaxUser = {
  user_id: number;
  name?: string;
  first_name?: string;
  last_name?: string;
};

type MaxImageAttachment = {
  type: 'image';
  payload: { url: string; token?: string; photo_id?: number };
};

type MaxMessage = {
  body?: {
    mid?: string;
    text?: string | null;
    attachments?: Array<MaxImageAttachment | { type: string; payload?: unknown }> | null;
  };
  sender?: MaxUser | null;
  recipient?: { chat_id?: number | null };
};

export type MaxUpdate = {
  update_type?: string;
  timestamp?: number;
  chat_id?: number;
  user?: MaxUser;
  message?: MaxMessage | null;
  callback?: {
    callback_id: string;
    payload?: string;
    user: MaxUser;
  };
};

type PendingCase = {
  input: CreateCaseInput;
  photo: MaxImageAttachment;
  idempotencyKey: string;
};

type Draft =
  | { state: 'awaiting_description'; idempotencyKey: string }
  | { state: 'awaiting_photo'; input: CreateCaseInput; idempotencyKey: string }
  | { state: 'awaiting_duplicate_choice'; pending: PendingCase; duplicateCaseId: string };

type UpdateContext = {
  user: MaxUser;
  userId: number;
  chatId?: number;
  text: string;
  messageId?: string;
  photo?: MaxImageAttachment;
  callbackId?: string;
  callbackPayload?: string;
};

const maxImageBytes = 8 * 1024 * 1024;
const allowedImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function escapeMarkdown(value: string): string {
  return value.replace(/([\\*_`\[\]()])/gu, '\\$1');
}

function inferCategory(description: string): CaseCategory {
  const value = description.toLocaleLowerCase('ru-RU');
  if (/(свет|ламп|освещ|темн)/u.test(value)) return 'lighting';
  if (/(лифт|кабин|шахт)/u.test(value)) return 'elevator';
  if (/(вод|теч|труб|кран|канализ)/u.test(value)) return 'water';
  if (/(отоп|батар|радиатор|холодн)/u.test(value)) return 'heating';
  if (/(двор|мусор|снег|лавоч|детск.*площад)/u.test(value)) return 'yard';
  if (/(двер|домофон|замок|подъезд)/u.test(value)) return 'entrance';
  return 'other';
}

function inferPlace(category: CaseCategory, description: string): string {
  const value = description.toLocaleLowerCase('ru-RU');
  if (/подвал/u.test(value)) return 'Подвал';
  if (/кры(ша|ше|ши)|кровл/u.test(value)) return 'Крыша';
  if (/этаж/u.test(value) || category === 'lighting') return 'Лестничная клетка';
  if (category === 'elevator') return 'Лифт';
  if (category === 'entrance') return 'Входная группа';
  if (category === 'yard') return 'Придомовая территория';
  return 'Общее имущество дома';
}

export function parseCaseDescription(rawDescription: string): CreateCaseInput {
  const description = normalizeText(rawDescription);
  const category = inferCategory(description);
  const entranceMatch = description.match(/подъезд(?:е|а|у|ом)?\s*(?:№|номер)?\s*(\d+[а-яa-z]?)/iu);
  const firstSentence = description.split(/[.!?\n]/u).find(Boolean) || description;
  const titleSource = firstSentence.trim().length >= 5 ? firstSentence : description;
  const title = titleSource.slice(0, 120).trim();
  return {
    title,
    description,
    category,
    ...(entranceMatch?.[1] ? { entrance: entranceMatch[1] } : {}),
    place: inferPlace(category, description),
  };
}

function updateContext(update: MaxUpdate): UpdateContext | undefined {
  const user = update.callback?.user || update.message?.sender || update.user;
  if (!user?.user_id) return undefined;
  const attachment = update.message?.body?.attachments?.find(
    (item): item is MaxImageAttachment =>
      item.type === 'image' &&
      Boolean(item.payload) &&
      typeof (item.payload as { url?: unknown }).url === 'string',
  );
  const chatId = update.message?.recipient?.chat_id ?? update.chat_id ?? undefined;
  return {
    user,
    userId: user.user_id,
    ...(chatId ? { chatId } : {}),
    text: normalizeText(update.message?.body?.text || '').toLocaleLowerCase('ru-RU'),
    ...(update.message?.body?.mid ? { messageId: update.message.body.mid } : {}),
    ...(attachment ? { photo: attachment } : {}),
    ...(update.callback?.callback_id ? { callbackId: update.callback.callback_id } : {}),
    ...(update.callback?.payload ? { callbackPayload: update.callback.payload } : {}),
  };
}

function displayName(user: MaxUser): string {
  return normalizeText([user.first_name, user.last_name].filter(Boolean).join(' ')) || user.name || `MAX ${user.user_id}`;
}

export class BotConversationService {
  private readonly drafts = new Map<string, Draft>();

  constructor(
    private readonly app: FastifyInstance,
    private readonly notifier: BotNotifier,
  ) {}

  async handle(update: MaxUpdate): Promise<void> {
    const context = updateContext(update);
    if (!context) return;
    const key = this.key(context);

    if (update.update_type === 'bot_started' || context.text === '/start') {
      const launchButton = this.miniAppButton('Открыть ДомДело');
      const actor = await this.resolveActor(context);
      const houseContext = await this.app.caseRepository.getHouseContext(actor);
      if (houseContext.onboardingRequired) {
        await this.send(
          context,
          '**Сначала добавьте адрес дома.**\n\nДомДело разделяет обращения по адресам. Откройте мини-приложение и добавьте хотя бы один дом — после этого создание дел станет доступно.',
          launchButton ? [[launchButton]] : undefined,
        );
        return;
      }
      const activeHouse = houseContext.houses.find((house) => house.isActive);
      const buttons: BotButton[][] = [[{ type: 'message', text: 'Создать дело' }]];
      if (launchButton) buttons.push([launchButton]);
      await this.send(
        context,
        `**ДомДело** превращает сообщение о проблеме в доме в прозрачное коллективное дело.\n\n${activeHouse ? `Текущий дом: **${escapeMarkdown(activeHouse.address)}**.\n\n` : ''}Создайте дело здесь или откройте мини-приложение.`,
        buttons,
      );
      return;
    }

    if (context.text === 'создать дело') {
      const actor = await this.resolveActor(context);
      const houseContext = await this.app.caseRepository.getHouseContext(actor);
      if (houseContext.onboardingRequired) {
        const launchButton = this.miniAppButton('Добавить адрес');
        await this.send(
          context,
          'Сначала добавьте адрес дома в мини-приложении.',
          launchButton ? [[launchButton]] : undefined,
        );
        return;
      }
      this.drafts.set(key, { state: 'awaiting_description', idempotencyKey: randomUUID() });
      await this.send(
        context,
        'Опишите проблему одним сообщением: **что произошло, где и когда**. Например: «В подъезде №2 со вчерашнего вечера не работает освещение на втором этаже».',
      );
      return;
    }

    const draft = this.drafts.get(key);
    if (!draft) {
      if (context.photo) {
        await this.send(context, 'Сначала нажмите «Создать дело», затем пришлите описание и фотографию.');
      }
      return;
    }

    if (draft.state === 'awaiting_description') {
      if (context.text.length < 10) {
        await this.send(context, 'Описание слишком короткое. Напишите, что произошло и точное место проблемы.');
        return;
      }
      const input = parseCaseDescription(update.message?.body?.text || context.text);
      this.drafts.set(key, { state: 'awaiting_photo', input, idempotencyKey: draft.idempotencyKey });
      if (context.photo && context.messageId) return this.handle(update);
      await this.send(
        context,
        `Понял: **${escapeMarkdown(input.title)}**\nМесто: ${escapeMarkdown(input.place)}${input.entrance ? `, подъезд ${escapeMarkdown(input.entrance)}` : ''}.\n\nТеперь прикрепите одну фотографию проблемы.`,
      );
      return;
    }

    if (draft.state === 'awaiting_photo') {
      if (!context.photo || !context.messageId) {
        await this.send(context, 'Жду фотографию проблемы. Её также можно добавить позже в мини-приложении.');
        return;
      }
      const actor = await this.resolveActor(context);
      const duplicates = await this.app.caseRepository.findDuplicates(actor, draft.input);
      const pending: PendingCase = {
        input: draft.input,
        photo: context.photo,
        idempotencyKey: draft.idempotencyKey,
      };
      if (duplicates[0]) {
        const duplicate = duplicates[0];
        this.drafts.set(key, {
          state: 'awaiting_duplicate_choice',
          pending,
          duplicateCaseId: duplicate.id,
        });
        await this.send(
          context,
          `Нашёл похожее открытое дело **№${duplicate.number}**: ${escapeMarkdown(duplicate.title)}\nУже подтвердили: ${duplicate.confirmationsCount}. Присоединить ваше сообщение к нему?`,
          [
            [{ type: 'callback', text: 'У меня тоже', payload: `domdelo:join:${duplicate.id}` }],
            [{ type: 'callback', text: 'Создать отдельное', payload: `domdelo:new:${duplicate.id}` }],
          ],
        );
        return;
      }

      await this.finish(context, actor, pending);
      return;
    }

    if (draft.state === 'awaiting_duplicate_choice') {
      const expectedJoin = `domdelo:join:${draft.duplicateCaseId}`;
      const expectedNew = `domdelo:new:${draft.duplicateCaseId}`;
      if (context.callbackPayload !== expectedJoin && context.callbackPayload !== expectedNew) return;
      const actor = await this.resolveActor(context);
      await this.finish(
        context,
        actor,
        draft.pending,
        context.callbackPayload === expectedJoin ? draft.duplicateCaseId : undefined,
      );
    }
  }

  private async resolveActor(context: UpdateContext): Promise<AuthenticatedActor> {
    return this.app.caseRepository.resolveMaxUser({
      maxUserId: BigInt(context.userId),
      displayName: displayName(context.user),
      ...(context.chatId ? { maxChatId: BigInt(context.chatId) } : {}),
    });
  }

  private async finish(
    context: UpdateContext,
    actor: AuthenticatedActor,
    pending: PendingCase,
    duplicateCaseId?: string,
  ): Promise<void> {
    try {
      const item = await this.app.caseRepository.createCase(
        actor,
        { ...pending.input, ...(duplicateCaseId ? { duplicateCaseId } : {}) },
        `max:${pending.idempotencyKey}`,
      );
      await this.attachPhoto(actor, item.id, pending.photo);
      this.drafts.delete(this.key(context));
      if (context.callbackId) await this.notifier.answerCallback(context.callbackId, 'Готово');
      const joined = Boolean(duplicateCaseId);
      const caseButton = this.miniAppButton(
        'Открыть карточку',
        `/cases/${item.id}`,
        `case_${item.id}`,
      );
      await this.send(
        context,
        joined
          ? `Вы присоединились к делу **№${item.number}**. Теперь проблему подтвердили ${item.confirmationsCount} жильцов.`
          : `Дело **№${item.number}** зарегистрировано. Ответственный: ${escapeMarkdown(item.responsibleOrganization)}.`,
        caseButton ? [[caseButton]] : undefined,
      );
    } catch (error) {
      await this.send(
        context,
        'Не удалось сохранить дело или фотографию. Ваше описание не потеряно — отправьте фотографию ещё раз либо повторите выбор.',
      );
      throw error;
    }
  }

  private async attachPhoto(actor: AuthenticatedActor, caseId: string, photo: MaxImageAttachment): Promise<void> {
    const url = new URL(photo.payload.url);
    if (url.protocol !== 'https:') throw new Error('MAX photo URL must use HTTPS');
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`MAX photo download failed: ${response.status}`);
    const advertisedSize = Number(response.headers.get('content-length') || 0);
    if (advertisedSize > maxImageBytes) throw new Error('MAX photo is too large');
    const contentType = (response.headers.get('content-type') || 'image/jpeg').split(';')[0]!.trim();
    if (!allowedImageTypes.has(contentType)) throw new Error('MAX photo has unsupported content type');
    const body = Buffer.from(await response.arrayBuffer());
    if (body.byteLength > maxImageBytes) throw new Error('MAX photo is too large');
    const extension = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg';
    const stored = await this.app.objectStorage.put(
      `cases/${caseId}/problem/${randomUUID()}.${extension}`,
      body,
      contentType,
    );
    await this.app.caseRepository.addAttachment(actor, caseId, {
      kind: 'problem',
      objectKey: stored.key,
      url: stored.url,
      fileName: `max-photo.${extension}`,
      mimeType: contentType,
      size: body.byteLength,
    });
  }

  private key(context: UpdateContext): string {
    return `${context.chatId || 'private'}:${context.userId}`;
  }

  private miniAppUrl(path = ''): string | undefined {
    const baseUrl = this.app.config.maxMiniAppUrl;
    return baseUrl ? `${baseUrl}${path}` : undefined;
  }

  private miniAppButton(text: string, path = '', payload?: string): BotButton | undefined {
    const botUsername = this.app.config.maxMiniAppBotUsername;
    if (botUsername) {
      return {
        type: 'open_app',
        text,
        web_app: botUsername,
        ...(payload ? { payload } : {}),
      };
    }
    const url = this.miniAppUrl(path);
    return url ? { type: 'link', text, url } : undefined;
  }

  private async send(context: UpdateContext, message: string, buttons?: BotButton[][]): Promise<void> {
    if (context.chatId) {
      await this.notifier.sendToChat(context.chatId, message, buttons ? { buttons } : undefined);
    } else {
      await this.notifier.sendToUser(context.userId, message, buttons ? { buttons } : undefined);
    }
  }
}
