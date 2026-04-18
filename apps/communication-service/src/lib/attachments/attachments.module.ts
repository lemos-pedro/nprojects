import {
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
  Headers,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { AttachmentsService } from './attachments.service';

const MAX_SIZE = 25 * 1024 * 1024; // 25 MB

const ALLOWED_MIME = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/ogg', 'audio/wav',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain', 'text/csv',
  'application/zip',
];

@Controller('attachments')
export class AttachmentsController {
  constructor(private readonly attachmentsService: AttachmentsService) {}

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_SIZE },
      fileFilter: (_req, file, cb) => {
        if (ALLOWED_MIME.includes(file.mimetype)) cb(null, true);
        else cb(new BadRequestException(`Tipo não permitido: ${file.mimetype}`), false);
      },
    }),
  )
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Headers('x-tenant-id') tenantId: string,
  ) {
    if (!file) throw new BadRequestException('Nenhum ficheiro recebido.');
    if (!tenantId) throw new BadRequestException('Header x-tenant-id obrigatório.');
    return this.attachmentsService.upload(file, tenantId);
  }
}