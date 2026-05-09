import { Controller, Get } from '@nestjs/common';

@Controller('advocate')
export class AdvocateController {
    @Get()
    getAdvocate(): string {
        return 'This is the Get all Advocate endpoint';
    }
}
