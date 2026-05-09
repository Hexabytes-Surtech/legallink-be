import { Test, TestingModule } from '@nestjs/testing';
import { AdvocateService } from './advocate.service';

describe('AdvocateService', () => {
  let service: AdvocateService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AdvocateService],
    }).compile();

    service = module.get<AdvocateService>(AdvocateService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
