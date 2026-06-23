import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { LeaveRequestsModule } from './leave-requests/leave-requests.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [PrismaModule, LeaveRequestsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
