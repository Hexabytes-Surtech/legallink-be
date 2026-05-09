import { Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';

@Injectable()
export class AdvocateService {
    constructor(private db: DatabaseService) {}

  async testDb() {
    const result = await this.db.query('SELECT NOW()');

    return result.rows;
  }
}
