import { Test, TestingModule } from '@nestjs/testing';
import { AdvocateController } from './advocate.controller';

describe('AdvocateController', () => {
  let controller: AdvocateController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdvocateController],
    }).compile();

    controller = module.get<AdvocateController>(AdvocateController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
