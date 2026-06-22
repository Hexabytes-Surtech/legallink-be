-- 029_MockCaseHistory.sql
-- Populates advocate_case_history with realistic West Bengal case data
-- for all advocates that have fewer than 3 existing entries.
-- Safe to re-run: skips advocates who already have 3+ entries.

DO $$
DECLARE
  adv       RECORD;
  area      TEXT;
  dist      TEXT;
  use_dist  TEXT;

  -- Court pools per matter type
  criminal_courts  TEXT[] := ARRAY[
    'Calcutta High Court',
    'City Sessions Court, Kolkata',
    'Alipore Criminal Court',
    'Barasat Sessions Court',
    'Howrah Sessions Court',
    'Burdwan Sessions Court',
    'Asansol Sessions Court',
    'Chief Metropolitan Magistrate Court, Kolkata'
  ];
  civil_courts TEXT[] := ARRAY[
    'City Civil Court, Kolkata',
    'Calcutta High Court',
    'Alipore District Court',
    'Barasat Civil Court',
    'Howrah District Court',
    'Hooghly District Court',
    'Krishnanagar District Court'
  ];
  family_courts TEXT[] := ARRAY[
    'Alipore Family Court',
    'Calcutta High Court (Family Division)',
    'Barasat Family Court',
    'Howrah Family Court',
    'Burdwan Family Court'
  ];
  labour_courts TEXT[] := ARRAY[
    'Labour Court No. 1, Kolkata',
    'Labour Court No. 2, Kolkata',
    'Labour Court, Howrah',
    'Calcutta High Court (Labour Bench)',
    'Alipore District Court',
    'Haldia Industrial Tribunal'
  ];
  tenancy_courts TEXT[] := ARRAY[
    'Rent Control Court, Kolkata',
    'City Civil Court, Kolkata',
    'Alipore District Court',
    'Small Causes Court, Kolkata',
    'Barasat Civil Court'
  ];
  traffic_courts TEXT[] := ARRAY[
    'Additional Chief Metropolitan Magistrate, Kolkata',
    'Alipore Magistrate Court',
    'Barasat Magistrate Court',
    'Howrah Magistrate Court',
    'Motor Accident Claims Tribunal, Kolkata'
  ];
  consumer_courts TEXT[] := ARRAY[
    'District Consumer Disputes Redressal Commission, Kolkata',
    'District Consumer Disputes Redressal Commission, South 24 Parganas',
    'District Consumer Disputes Redressal Commission, North 24 Parganas',
    'District Consumer Disputes Redressal Commission, Howrah',
    'West Bengal State Consumer Disputes Redressal Commission'
  ];

  -- District pools per matter type (WB districts)
  criminal_districts  TEXT[] := ARRAY['Kolkata','South 24 Parganas','Howrah','North 24 Parganas','Paschim Bardhaman','Murshidabad'];
  civil_districts     TEXT[] := ARRAY['Kolkata','Howrah','South 24 Parganas','Hooghly','Nadia','Purba Bardhaman'];
  family_districts    TEXT[] := ARRAY['Kolkata','Howrah','North 24 Parganas','South 24 Parganas','Nadia'];
  labour_districts    TEXT[] := ARRAY['Kolkata','Howrah','South 24 Parganas','Paschim Medinipur','Paschim Bardhaman','Purba Medinipur'];
  tenancy_districts   TEXT[] := ARRAY['Kolkata','Howrah','North 24 Parganas','South 24 Parganas','Birbhum'];
  traffic_districts   TEXT[] := ARRAY['Kolkata','Howrah','South 24 Parganas','North 24 Parganas','Nadia'];
  consumer_districts  TEXT[] := ARRAY['Kolkata','Howrah','South 24 Parganas','North 24 Parganas','Purba Bardhaman'];

  -- Outcome patterns per matter type (weighted towards realistic distribution)
  criminal_outcomes TEXT[] := ARRAY['won','won','settled','ongoing','won','settled','won','ongoing'];
  civil_outcomes    TEXT[] := ARRAY['won','settled','settled','won','ongoing','settled','won'];
  family_outcomes   TEXT[] := ARRAY['settled','settled','won','ongoing','settled','won','settled'];
  labour_outcomes   TEXT[] := ARRAY['won','won','settled','won','ongoing','won','settled'];
  tenancy_outcomes  TEXT[] := ARRAY['won','settled','won','won','ongoing','settled'];
  traffic_outcomes  TEXT[] := ARRAY['won','won','settled','won','won','settled','ongoing'];
  consumer_outcomes TEXT[] := ARRAY['won','won','settled','won','ongoing','settled'];

  -- Notes templates per matter type
  criminal_notes TEXT[] := ARRAY[
    'Bail secured within 48 hours, charges eventually dropped.',
    'Acquittal obtained after cross-examination exposed inconsistencies in prosecution witnesses.',
    'Successfully argued for reduction of charges from IPC 307 to IPC 323.',
    'Secured anticipatory bail under CrPC 438 preventing arrest.',
    'Negotiated plea agreement reducing sentence significantly.',
    'Victim compensation arranged through Lok Adalat proceeding.',
    'Conviction challenged in High Court, sentence suspended pending appeal.',
    NULL
  ];
  civil_notes TEXT[] := ARRAY[
    'Obtained interim injunction restraining alienation of disputed property.',
    'Partition suit decreed in client''s favour after survey report.',
    'Cheque bounce matter resolved under Section 138 NI Act; full recovery achieved.',
    'Title dispute settled after tracing chain of documents to 1953.',
    'Execution of decree for possession after lengthy enforcement proceedings.',
    'Damages awarded for breach of contract including interest at 9% p.a.',
    NULL
  ];
  family_notes TEXT[] := ARRAY[
    'Mutual consent divorce finalised with equitable asset division.',
    'Maintenance order of ₹25,000/month secured under CrPC 125.',
    'Child custody awarded to client with reasonable visitation rights to other parent.',
    'Domestic violence protection order obtained within 3 days of filing.',
    'Matrimonial property dispute resolved through mediation.',
    'Permanent alimony negotiated as lump sum settlement.',
    NULL
  ];
  labour_notes TEXT[] := ARRAY[
    'Reinstatement with full back wages ordered by Labour Court.',
    'Illegal retrenchment under IDA 25F challenged; compensation awarded.',
    'ESI and PF dues of ₹4.2 lakh recovered from defaulting employer.',
    'Wrongful termination case settled through conciliation with 18 months'' salary.',
    'Overtime and minimum wage violation established; penalty imposed on employer.',
    'Contract labour regularisation order passed by court.',
    NULL
  ];
  tenancy_notes TEXT[] := ARRAY[
    'Eviction decree obtained after establishing subletting without consent.',
    'Rent revision set aside; standard rent fixed by Rent Controller.',
    'Tenant''s rights protected against illegal lock-out by landlord.',
    'Possession restored after landlord''s unlawful eviction attempt.',
    'Mesne profits awarded from date of illegal occupation.',
    NULL
  ];
  traffic_notes TEXT[] := ARRAY[
    'MACT claim of ₹18 lakh awarded for road accident injuries.',
    'Motor insurance company directed to pay full compensation without reduction.',
    'Third-party liability established; insurer cannot repudiate claim.',
    'Compounding of offence under MV Act negotiated, licence restored.',
    'Enhanced compensation secured on appeal to High Court.',
    NULL
  ];
  consumer_notes TEXT[] := ARRAY[
    'Deficiency in service by bank proven; ₹2.4 lakh plus compensation awarded.',
    'Defective product replaced and full refund ordered by Consumer Forum.',
    'Insurance claim wrongfully rejected; insurer directed to pay with interest.',
    'Builder directed to register flat and pay delay compensation of ₹1,000/month.',
    'Medical negligence established; hospital ordered to pay ₹12 lakh.',
    NULL
  ];

  court_var    TEXT;
  outcome_var  TEXT;
  year_var     SMALLINT;
  notes_var    TEXT;
  case_count   INT;
  entry_count  INT;
  idx          INT;

BEGIN
  FOR adv IN
    SELECT a.id, a.practice_areas, a.districts
    FROM advocates a
    WHERE a.verification_status IN ('verified', 'pending', 'submitted')
  LOOP
    -- Skip advocates who already have 3+ entries
    SELECT COUNT(*) INTO case_count FROM advocate_case_history WHERE advocate_id = adv.id;
    IF case_count >= 3 THEN
      CONTINUE;
    END IF;

    entry_count := 0;

    FOREACH area IN ARRAY adv.practice_areas LOOP
      -- Insert 3–5 cases per practice area
      FOR i IN 1..( 3 + (EXTRACT(EPOCH FROM NOW())::INT % 3) ) LOOP

        -- Pick a district: prefer advocate's own districts, fall back to type pool
        IF adv.districts IS NOT NULL AND array_length(adv.districts, 1) > 0 THEN
          use_dist := adv.districts[ 1 + ((i + entry_count) % array_length(adv.districts, 1)) ];
        ELSE
          CASE area
            WHEN 'Criminal' THEN use_dist := criminal_districts[ 1 + (i % array_length(criminal_districts,1)) ];
            WHEN 'Civil'    THEN use_dist := civil_districts[    1 + (i % array_length(civil_districts,1)) ];
            WHEN 'Family'   THEN use_dist := family_districts[   1 + (i % array_length(family_districts,1)) ];
            WHEN 'Labour'   THEN use_dist := labour_districts[   1 + (i % array_length(labour_districts,1)) ];
            WHEN 'Tenancy'  THEN use_dist := tenancy_districts[  1 + (i % array_length(tenancy_districts,1)) ];
            WHEN 'Traffic'  THEN use_dist := traffic_districts[  1 + (i % array_length(traffic_districts,1)) ];
            WHEN 'Consumer' THEN use_dist := consumer_districts[ 1 + (i % array_length(consumer_districts,1)) ];
            ELSE use_dist := 'Kolkata';
          END CASE;
        END IF;

        -- Pick court for district
        idx := 1 + ((i + entry_count) % 5);
        CASE area
          WHEN 'Criminal' THEN court_var   := criminal_courts[  LEAST(idx, array_length(criminal_courts,1)) ];
          WHEN 'Civil'    THEN court_var   := civil_courts[     LEAST(idx, array_length(civil_courts,1)) ];
          WHEN 'Family'   THEN court_var   := family_courts[    LEAST(idx, array_length(family_courts,1)) ];
          WHEN 'Labour'   THEN court_var   := labour_courts[    LEAST(idx, array_length(labour_courts,1)) ];
          WHEN 'Tenancy'  THEN court_var   := tenancy_courts[   LEAST(idx, array_length(tenancy_courts,1)) ];
          WHEN 'Traffic'  THEN court_var   := traffic_courts[   LEAST(idx, array_length(traffic_courts,1)) ];
          WHEN 'Consumer' THEN court_var   := consumer_courts[  LEAST(idx, array_length(consumer_courts,1)) ];
          ELSE court_var := 'Calcutta High Court';
        END CASE;

        -- Pick outcome
        idx := 1 + ((i + entry_count * 2) % 7);
        CASE area
          WHEN 'Criminal' THEN outcome_var := criminal_outcomes[ LEAST(idx, array_length(criminal_outcomes,1)) ];
          WHEN 'Civil'    THEN outcome_var := civil_outcomes[    LEAST(idx, array_length(civil_outcomes,1)) ];
          WHEN 'Family'   THEN outcome_var := family_outcomes[   LEAST(idx, array_length(family_outcomes,1)) ];
          WHEN 'Labour'   THEN outcome_var := labour_outcomes[   LEAST(idx, array_length(labour_outcomes,1)) ];
          WHEN 'Tenancy'  THEN outcome_var := tenancy_outcomes[  LEAST(idx, array_length(tenancy_outcomes,1)) ];
          WHEN 'Traffic'  THEN outcome_var := traffic_outcomes[  LEAST(idx, array_length(traffic_outcomes,1)) ];
          WHEN 'Consumer' THEN outcome_var := consumer_outcomes[ LEAST(idx, array_length(consumer_outcomes,1)) ];
          ELSE outcome_var := 'settled';
        END CASE;

        -- Year: spread between 2018 and 2024
        year_var := (2018 + ((i + entry_count) % 7))::SMALLINT;

        -- Pick notes (NULL ~25% of time)
        idx := 1 + ((i + entry_count) % 8);
        CASE area
          WHEN 'Criminal' THEN notes_var := criminal_notes[ LEAST(idx, array_length(criminal_notes,1)) ];
          WHEN 'Civil'    THEN notes_var := civil_notes[    LEAST(idx, array_length(civil_notes,1)) ];
          WHEN 'Family'   THEN notes_var := family_notes[   LEAST(idx, array_length(family_notes,1)) ];
          WHEN 'Labour'   THEN notes_var := labour_notes[   LEAST(idx, array_length(labour_notes,1)) ];
          WHEN 'Tenancy'  THEN notes_var := tenancy_notes[  LEAST(idx, array_length(tenancy_notes,1)) ];
          WHEN 'Traffic'  THEN notes_var := traffic_notes[  LEAST(idx, array_length(traffic_notes,1)) ];
          WHEN 'Consumer' THEN notes_var := consumer_notes[ LEAST(idx, array_length(consumer_notes,1)) ];
          ELSE notes_var := NULL;
        END CASE;

        INSERT INTO advocate_case_history
          (advocate_id, matter_type, court, district, outcome, year, notes)
        VALUES
          (adv.id, area, court_var, use_dist, outcome_var, year_var, notes_var);

        entry_count := entry_count + 1;
      END LOOP;
    END LOOP;

    RAISE NOTICE 'Inserted % entries for advocate %', entry_count, adv.id;
  END LOOP;
END $$;
