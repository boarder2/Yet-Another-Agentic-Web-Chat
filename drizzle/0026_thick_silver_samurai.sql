CREATE INDEX `messages_chat_idx` ON `messages` (`chatId`,`type`);--> statement-breakpoint
CREATE INDEX `messages_message_idx` ON `messages` (`messageId`);