import { Test, TestingModule } from '@nestjs/testing';
import { PrismaModule } from './prisma.module';
import { PrismaService } from './prisma.service';

describe('PrismaService', () => {
  let module: TestingModule;
  let prisma: PrismaService;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [PrismaModule],
    }).compile();

    const app = module.createNestApplication();
    await app.init();
    prisma = module.get(PrismaService);
  });

  afterAll(async () => {
    await module.close();
  });

  it('connects to the database and can query the seeded tenant', async () => {
    const tenant = await prisma.tenant.findUnique({
      where: { id: 'tenant-001' },
    });
    expect(tenant).not.toBeNull();
    expect(tenant?.name).toBe('Acme Corp');
  });
});
