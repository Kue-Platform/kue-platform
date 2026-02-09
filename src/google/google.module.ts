import { Module } from '@nestjs/common';
import { GmailService } from './gmail.service';
import { ContactsService } from './contacts.service';
import { CalendarService } from './calendar.service';

@Module({
  providers: [GmailService, ContactsService, CalendarService],
  exports: [GmailService, ContactsService, CalendarService],
})
export class GoogleModule {}
