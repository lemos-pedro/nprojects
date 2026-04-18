import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';
import * as path from 'path';

@Injectable()
export class AttachmentsService {
  private readonly s3: S3Client;
  private readonly bucket = 'ngola-attachments';
  private readonly accountId = '16ac7e862c9a1eef424dda69bf3814a2';

  constructor() {
    this.s3 = new S3Client({
      region: 'auto',
      endpoint: `https://${this.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
    });
  }

  async upload(
    file: Express.Multer.File,
    tenantId: string,
  ): Promise<{ url: string; fileName: string; fileType: string; fileSize: number }> {
    const ext = path.extname(file.originalname);
    const key = `${tenantId}/${randomUUID()}${ext}`;

    try {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: file.buffer,
          ContentType: file.mimetype,
          ContentDisposition: `inline; filename="${file.originalname}"`,
        }),
      );
    } catch (err) {
      throw new InternalServerErrorException(`R2 upload falhou: ${(err as Error).message}`);
    }

    // URL pública — após activares o domínio público no R2 substitui pelo domínio
    const url = `https://${this.accountId}.r2.cloudflarestorage.com/${this.bucket}/${key}`;

    return { url, fileName: file.originalname, fileType: file.mimetype, fileSize: file.size };
  }
}