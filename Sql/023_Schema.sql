--
-- PostgreSQL database dump
--

\restrict 8xFWAaVsiraiyHbiT6oCp4AYKdcPp6nYMysvorGJpIuHIMV83BP2puokQcDpOJo

-- Dumped from database version 18.4 (72c6e7c)
-- Dumped by pg_dump version 18.0

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: vector; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;


--
-- Name: EXTENSION vector; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION vector IS 'vector data type and ivfflat and hnsw access methods';


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: neondb_owner
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.set_updated_at() OWNER TO neondb_owner;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: advocate; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.advocate (
    advocate_id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    enrolment_number text NOT NULL,
    practice_areas text[] DEFAULT '{}'::text[] NOT NULL,
    languages text[] DEFAULT '{}'::text[] NOT NULL,
    districts text[] DEFAULT '{}'::text[] NOT NULL,
    verification_status text DEFAULT 'pending'::text NOT NULL,
    bio_text text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.advocate OWNER TO neondb_owner;

--
-- Name: advocate_availability; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.advocate_availability (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    advocate_id uuid NOT NULL,
    day_of_week integer NOT NULL,
    start_time time without time zone NOT NULL,
    end_time time without time zone NOT NULL,
    slot_duration_minutes integer DEFAULT 30 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    CONSTRAINT advocate_availability_day_of_week_check CHECK (((day_of_week >= 0) AND (day_of_week <= 6))),
    CONSTRAINT advocate_availability_slot_duration_minutes_check CHECK ((slot_duration_minutes = ANY (ARRAY[15, 30, 60]))),
    CONSTRAINT chk_end_after_start CHECK ((end_time > start_time))
);


ALTER TABLE public.advocate_availability OWNER TO neondb_owner;

--
-- Name: advocate_verification_documents; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.advocate_verification_documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    advocate_id uuid NOT NULL,
    file_path character varying(500) NOT NULL,
    file_type character varying(100) NOT NULL,
    uploaded_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.advocate_verification_documents OWNER TO neondb_owner;

--
-- Name: advocates; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.advocates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    bar_enrolment_number character varying(50),
    state_bar character varying(100) NOT NULL,
    name character varying(255) NOT NULL,
    address text NOT NULL,
    email character varying(255),
    practice_areas text[] DEFAULT '{}'::text[] NOT NULL,
    courts text[] DEFAULT '{}'::text[] NOT NULL,
    languages text[] DEFAULT '{}'::text[] NOT NULL,
    districts text[] DEFAULT '{}'::text[] NOT NULL,
    verification_status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    phone character varying(20) DEFAULT ''::character varying NOT NULL,
    bio text,
    submitted_at timestamp with time zone,
    rejection_reason text,
    CONSTRAINT advocates_verification_status_check CHECK (((verification_status)::text = ANY ((ARRAY['pending'::character varying, 'submitted'::character varying, 'verified'::character varying, 'rejected'::character varying])::text[])))
);


ALTER TABLE public.advocates OWNER TO neondb_owner;

--
-- Name: ai_conversation; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.ai_conversation (
    conversation_id uuid DEFAULT gen_random_uuid() NOT NULL,
    citizen_id uuid,
    session_id uuid,
    matter_id uuid,
    language text DEFAULT 'en'::text NOT NULL,
    phase text DEFAULT 'triage'::text NOT NULL,
    is_legal boolean,
    ready_to_connect boolean DEFAULT false NOT NULL,
    question_count integer DEFAULT 0 NOT NULL,
    classification_json jsonb,
    brief_json jsonb,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ai_conversation_language_check CHECK ((language = ANY (ARRAY['en'::text, 'bn'::text]))),
    CONSTRAINT ai_conversation_phase_check CHECK ((phase = ANY (ARRAY['triage'::text, 'gathering'::text, 'ready'::text, 'closed'::text])))
);


ALTER TABLE public.ai_conversation OWNER TO neondb_owner;

--
-- Name: ai_conversation_message; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.ai_conversation_message (
    message_id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    role text NOT NULL,
    content text NOT NULL,
    meta jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ai_conversation_message_role_check CHECK ((role = ANY (ARRAY['user'::text, 'assistant'::text])))
);


ALTER TABLE public.ai_conversation_message OWNER TO neondb_owner;

--
-- Name: citizen_report; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.citizen_report (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    consultation_id uuid NOT NULL,
    advocate_id uuid NOT NULL,
    citizen_id uuid NOT NULL,
    reason text NOT NULL,
    note text,
    status text DEFAULT 'open'::text NOT NULL,
    admin_note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    reviewed_at timestamp with time zone,
    CONSTRAINT citizen_report_reason_check CHECK ((reason = ANY (ARRAY['abusive'::text, 'spam'::text, 'ended_unfairly'::text, 'off_platform_contact'::text, 'other'::text]))),
    CONSTRAINT citizen_report_status_check CHECK ((status = ANY (ARRAY['open'::text, 'reviewed'::text, 'dismissed'::text])))
);


ALTER TABLE public.citizen_report OWNER TO neondb_owner;

--
-- Name: citizens; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.citizens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    state character varying(100) DEFAULT 'WB'::character varying NOT NULL,
    district character varying(100),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.citizens OWNER TO neondb_owner;

--
-- Name: TABLE citizens; Type: COMMENT; Schema: public; Owner: neondb_owner
--

COMMENT ON TABLE public.citizens IS 'Citizen-specific profile row. One per user where role=citizen. Extended via users.name / users.address.';


--
-- Name: consultation_appointment; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.consultation_appointment (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    consultation_id uuid NOT NULL,
    scheduled_at timestamp with time zone NOT NULL,
    duration_minutes integer DEFAULT 30 NOT NULL,
    status text DEFAULT 'scheduled'::text NOT NULL,
    advocate_notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    advocate_id uuid NOT NULL,
    CONSTRAINT consultation_appointment_status_check CHECK ((status = ANY (ARRAY['scheduled'::text, 'completed'::text, 'cancelled'::text, 'no_show'::text])))
);


ALTER TABLE public.consultation_appointment OWNER TO neondb_owner;

--
-- Name: consultation_feedback; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.consultation_feedback (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    consultation_id uuid NOT NULL,
    citizen_id uuid NOT NULL,
    advocate_id uuid NOT NULL,
    rating integer NOT NULL,
    comment text,
    is_visible boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT consultation_feedback_rating_check CHECK (((rating >= 1) AND (rating <= 5)))
);


ALTER TABLE public.consultation_feedback OWNER TO neondb_owner;

--
-- Name: consultation_request; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.consultation_request (
    request_id uuid DEFAULT gen_random_uuid() NOT NULL,
    matter_id uuid NOT NULL,
    advocate_id uuid NOT NULL,
    citizen_id uuid,
    status text DEFAULT 'pending'::text NOT NULL,
    citizen_note text,
    advocate_note text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    citizen_read boolean DEFAULT true,
    citizen_last_read_at timestamp with time zone,
    advocate_last_read_at timestamp with time zone,
    CONSTRAINT consultation_request_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'declined'::text, 'closed'::text])))
);


ALTER TABLE public.consultation_request OWNER TO neondb_owner;

--
-- Name: consultations; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.consultations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    matter_id uuid NOT NULL,
    citizen_id uuid NOT NULL,
    advocate_id uuid NOT NULL,
    status character varying(20) DEFAULT 'requested'::character varying NOT NULL,
    requested_at timestamp with time zone DEFAULT now() NOT NULL,
    accepted_at timestamp with time zone,
    CONSTRAINT consultations_status_check CHECK (((status)::text = ANY ((ARRAY['requested'::character varying, 'accepted'::character varying, 'declined'::character varying, 'closed'::character varying])::text[])))
);


ALTER TABLE public.consultations OWNER TO neondb_owner;

--
-- Name: conversation_message; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.conversation_message (
    message_id uuid DEFAULT gen_random_uuid() NOT NULL,
    matter_id uuid NOT NULL,
    request_id uuid NOT NULL,
    sender_type text NOT NULL,
    sender_id uuid,
    content text NOT NULL,
    moderation_status text DEFAULT 'cleared'::text NOT NULL,
    moderation_flags text[] DEFAULT '{}'::text[],
    created_at timestamp with time zone DEFAULT now(),
    attachment_url text,
    attachment_type text,
    attachment_name text,
    attachment_size integer,
    deleted_at timestamp without time zone,
    CONSTRAINT conversation_message_attachment_type_check CHECK (((attachment_type IS NULL) OR (attachment_type = ANY (ARRAY['image'::text, 'pdf'::text])))),
    CONSTRAINT conversation_message_moderation_status_check CHECK ((moderation_status = ANY (ARRAY['cleared'::text, 'flagged'::text, 'pending'::text, 'dismissed'::text]))),
    CONSTRAINT conversation_message_sender_type_check CHECK ((sender_type = ANY (ARRAY['citizen'::text, 'advocate'::text])))
);


ALTER TABLE public.conversation_message OWNER TO neondb_owner;

--
-- Name: documents; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    matter_id uuid NOT NULL,
    uploader_id uuid NOT NULL,
    file_path character varying(500) NOT NULL,
    file_type character varying(100) NOT NULL,
    size integer NOT NULL,
    uploaded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT documents_size_check CHECK ((size > 0))
);


ALTER TABLE public.documents OWNER TO neondb_owner;

--
-- Name: legal_document_unit; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.legal_document_unit (
    unit_id uuid NOT NULL,
    source_id text NOT NULL,
    source_type text NOT NULL,
    jurisdiction_level text NOT NULL,
    state_code text,
    district_code text,
    court_code text,
    doc_title text NOT NULL,
    doc_version_id uuid NOT NULL,
    hierarchy_path text NOT NULL,
    node_type text NOT NULL,
    node_label text,
    citation_text text,
    language_code text NOT NULL,
    text_content text NOT NULL,
    effective_from date,
    effective_to date,
    legal_status text NOT NULL,
    checksum_sha256 text NOT NULL,
    source_uri text,
    metadata_json jsonb,
    created_at timestamp with time zone DEFAULT now(),
    embedding public.vector(768)
);


ALTER TABLE public.legal_document_unit OWNER TO neondb_owner;

--
-- Name: legal_hierarchy_edge; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.legal_hierarchy_edge (
    parent_unit_id uuid NOT NULL,
    child_unit_id uuid NOT NULL,
    edge_type text NOT NULL
);


ALTER TABLE public.legal_hierarchy_edge OWNER TO neondb_owner;

--
-- Name: legal_unit; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.legal_unit (
    unit_id uuid NOT NULL,
    act_id text NOT NULL,
    act_name text NOT NULL,
    citation text NOT NULL,
    hierarchy_path text NOT NULL,
    section_number text NOT NULL,
    section_title text,
    text_content text NOT NULL,
    legal_status text DEFAULT 'active'::text NOT NULL,
    language_code text DEFAULT 'en'::text NOT NULL,
    source_file text,
    source_sha256 text,
    doc_type text NOT NULL,
    jurisdiction text NOT NULL,
    version_tag text DEFAULT 'v1'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    search_vector tsvector
);


ALTER TABLE public.legal_unit OWNER TO neondb_owner;

--
-- Name: matter; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.matter (
    matter_id uuid DEFAULT gen_random_uuid() NOT NULL,
    citizen_id uuid,
    intake_text text NOT NULL,
    intake_language text DEFAULT 'en'::text NOT NULL,
    status text DEFAULT 'created'::text NOT NULL,
    category_primary text,
    category_secondary text[],
    jurisdiction_state text DEFAULT 'WB'::text,
    jurisdiction_district text,
    preferred_language text DEFAULT 'en'::text NOT NULL,
    incident_date date,
    urgency_level text DEFAULT 'medium'::text,
    completeness_score numeric(5,2),
    confidence_score numeric(5,2),
    advocate_status text DEFAULT 'not_requested'::text,
    classification_json jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    human_review_required boolean DEFAULT false NOT NULL,
    missing_info_questions jsonb,
    reviewer_note text,
    reviewed_at timestamp with time zone,
    session_id uuid,
    expires_at timestamp with time zone
);


ALTER TABLE public.matter OWNER TO neondb_owner;

--
-- Name: matter_advocate_shortlist; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.matter_advocate_shortlist (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    matter_id uuid NOT NULL,
    advocate_id uuid NOT NULL,
    citizen_initiated boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.matter_advocate_shortlist OWNER TO neondb_owner;

--
-- Name: matter_brief_version; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.matter_brief_version (
    brief_id uuid DEFAULT gen_random_uuid() NOT NULL,
    matter_id uuid NOT NULL,
    language_code text DEFAULT 'en'::text NOT NULL,
    brief_json jsonb NOT NULL,
    grounded boolean DEFAULT false NOT NULL,
    generated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.matter_brief_version OWNER TO neondb_owner;

--
-- Name: matter_citation; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.matter_citation (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    matter_id uuid NOT NULL,
    unit_id uuid NOT NULL,
    relevance_score numeric(8,6),
    retrieval_method text DEFAULT 'hybrid'::text NOT NULL,
    lexical_rank integer,
    semantic_rank integer,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.matter_citation OWNER TO neondb_owner;

--
-- Name: matter_event; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.matter_event (
    event_id uuid DEFAULT gen_random_uuid() NOT NULL,
    matter_id uuid NOT NULL,
    event_type text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    actor_type text DEFAULT 'system'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.matter_event OWNER TO neondb_owner;

--
-- Name: matters; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.matters (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    session_id uuid,
    query_text text NOT NULL,
    query_language character varying(2) NOT NULL,
    classification jsonb,
    citations jsonb,
    ai_response_english text,
    ai_response_bengali text,
    disclaimer text,
    status character varying(20) DEFAULT 'session-owned'::character varying NOT NULL,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT matters_query_language_check CHECK (((query_language)::text = ANY ((ARRAY['bn'::character varying, 'en'::character varying])::text[]))),
    CONSTRAINT matters_status_check CHECK (((status)::text = ANY ((ARRAY['session-owned'::character varying, 'user-owned'::character varying, 'archived'::character varying])::text[])))
);


ALTER TABLE public.matters OWNER TO neondb_owner;

--
-- Name: messages; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    consultation_id uuid NOT NULL,
    sender_type character varying(10) NOT NULL,
    sender_id uuid NOT NULL,
    content text NOT NULL,
    moderation_status character varying(15) DEFAULT 'approved'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT messages_moderation_status_check CHECK (((moderation_status)::text = ANY ((ARRAY['approved'::character varying, 'pending'::character varying, 'flagged'::character varying])::text[]))),
    CONSTRAINT messages_sender_type_check CHECK (((sender_type)::text = ANY ((ARRAY['citizen'::character varying, 'advocate'::character varying])::text[])))
);


ALTER TABLE public.messages OWNER TO neondb_owner;

--
-- Name: response_trace; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.response_trace (
    trace_id uuid DEFAULT gen_random_uuid() NOT NULL,
    matter_id uuid,
    query_text text NOT NULL,
    query_language text DEFAULT 'en'::text NOT NULL,
    source_unit_ids uuid[] NOT NULL,
    verifier_status text DEFAULT 'pass'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    brief_id uuid,
    sentence_index integer,
    sentence_text text
);


ALTER TABLE public.response_trace OWNER TO neondb_owner;

--
-- Name: users; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email character varying(255) NOT NULL,
    email_verified boolean DEFAULT false NOT NULL,
    role character varying(20) NOT NULL,
    preferred_language character varying(2) DEFAULT 'en'::character varying NOT NULL,
    otp_code character varying(255),
    otp_expires_at timestamp with time zone,
    refresh_token text,
    refresh_token_expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    avatar_url text,
    name character varying(255),
    address text,
    CONSTRAINT users_preferred_language_check CHECK (((preferred_language)::text = ANY ((ARRAY['bn'::character varying, 'en'::character varying])::text[]))),
    CONSTRAINT users_role_check CHECK (((role)::text = ANY ((ARRAY['citizen'::character varying, 'advocate'::character varying, 'admin'::character varying])::text[])))
);


ALTER TABLE public.users OWNER TO neondb_owner;

--
-- Name: COLUMN users.avatar_url; Type: COMMENT; Schema: public; Owner: neondb_owner
--

COMMENT ON COLUMN public.users.avatar_url IS 'Cloudinary image URL — e.g. https://res.cloudinary.com/<cloud>/image/upload/v123/avatars/<user_id>.jpg';


--
-- Name: COLUMN users.name; Type: COMMENT; Schema: public; Owner: neondb_owner
--

COMMENT ON COLUMN public.users.name IS 'Full display name — common to all roles';


--
-- Name: COLUMN users.address; Type: COMMENT; Schema: public; Owner: neondb_owner
--

COMMENT ON COLUMN public.users.address IS 'Home / correspondence address — common to all roles';


--
-- Name: advocate_availability advocate_availability_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.advocate_availability
    ADD CONSTRAINT advocate_availability_pkey PRIMARY KEY (id);


--
-- Name: advocate advocate_enrolment_number_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.advocate
    ADD CONSTRAINT advocate_enrolment_number_key UNIQUE (enrolment_number);


--
-- Name: advocate advocate_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.advocate
    ADD CONSTRAINT advocate_pkey PRIMARY KEY (advocate_id);


--
-- Name: advocate_verification_documents advocate_verification_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.advocate_verification_documents
    ADD CONSTRAINT advocate_verification_documents_pkey PRIMARY KEY (id);


--
-- Name: advocates advocates_bar_enrolment_number_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.advocates
    ADD CONSTRAINT advocates_bar_enrolment_number_key UNIQUE (bar_enrolment_number);


--
-- Name: advocates advocates_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.advocates
    ADD CONSTRAINT advocates_pkey PRIMARY KEY (id);


--
-- Name: advocates advocates_user_id_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.advocates
    ADD CONSTRAINT advocates_user_id_key UNIQUE (user_id);


--
-- Name: ai_conversation_message ai_conversation_message_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.ai_conversation_message
    ADD CONSTRAINT ai_conversation_message_pkey PRIMARY KEY (message_id);


--
-- Name: ai_conversation ai_conversation_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.ai_conversation
    ADD CONSTRAINT ai_conversation_pkey PRIMARY KEY (conversation_id);


--
-- Name: citizen_report citizen_report_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.citizen_report
    ADD CONSTRAINT citizen_report_pkey PRIMARY KEY (id);


--
-- Name: citizens citizens_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.citizens
    ADD CONSTRAINT citizens_pkey PRIMARY KEY (id);


--
-- Name: citizens citizens_user_id_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.citizens
    ADD CONSTRAINT citizens_user_id_key UNIQUE (user_id);


--
-- Name: consultation_appointment consultation_appointment_consultation_id_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.consultation_appointment
    ADD CONSTRAINT consultation_appointment_consultation_id_key UNIQUE (consultation_id);


--
-- Name: consultation_appointment consultation_appointment_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.consultation_appointment
    ADD CONSTRAINT consultation_appointment_pkey PRIMARY KEY (id);


--
-- Name: consultation_feedback consultation_feedback_consultation_id_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.consultation_feedback
    ADD CONSTRAINT consultation_feedback_consultation_id_key UNIQUE (consultation_id);


--
-- Name: consultation_feedback consultation_feedback_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.consultation_feedback
    ADD CONSTRAINT consultation_feedback_pkey PRIMARY KEY (id);


--
-- Name: consultation_request consultation_request_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.consultation_request
    ADD CONSTRAINT consultation_request_pkey PRIMARY KEY (request_id);


--
-- Name: consultations consultations_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.consultations
    ADD CONSTRAINT consultations_pkey PRIMARY KEY (id);


--
-- Name: conversation_message conversation_message_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.conversation_message
    ADD CONSTRAINT conversation_message_pkey PRIMARY KEY (message_id);


--
-- Name: documents documents_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_pkey PRIMARY KEY (id);


--
-- Name: legal_document_unit legal_document_unit_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.legal_document_unit
    ADD CONSTRAINT legal_document_unit_pkey PRIMARY KEY (unit_id);


--
-- Name: legal_hierarchy_edge legal_hierarchy_edge_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.legal_hierarchy_edge
    ADD CONSTRAINT legal_hierarchy_edge_pkey PRIMARY KEY (parent_unit_id, child_unit_id, edge_type);


--
-- Name: legal_unit legal_unit_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.legal_unit
    ADD CONSTRAINT legal_unit_pkey PRIMARY KEY (unit_id);


--
-- Name: matter_advocate_shortlist matter_advocate_shortlist_matter_id_advocate_id_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.matter_advocate_shortlist
    ADD CONSTRAINT matter_advocate_shortlist_matter_id_advocate_id_key UNIQUE (matter_id, advocate_id);


--
-- Name: matter_advocate_shortlist matter_advocate_shortlist_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.matter_advocate_shortlist
    ADD CONSTRAINT matter_advocate_shortlist_pkey PRIMARY KEY (id);


--
-- Name: matter_brief_version matter_brief_version_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.matter_brief_version
    ADD CONSTRAINT matter_brief_version_pkey PRIMARY KEY (brief_id);


--
-- Name: matter_citation matter_citation_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.matter_citation
    ADD CONSTRAINT matter_citation_pkey PRIMARY KEY (id);


--
-- Name: matter_event matter_event_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.matter_event
    ADD CONSTRAINT matter_event_pkey PRIMARY KEY (event_id);


--
-- Name: matter matter_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.matter
    ADD CONSTRAINT matter_pkey PRIMARY KEY (matter_id);


--
-- Name: matters matters_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.matters
    ADD CONSTRAINT matters_pkey PRIMARY KEY (id);


--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);


--
-- Name: response_trace response_trace_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.response_trace
    ADD CONSTRAINT response_trace_pkey PRIMARY KEY (trace_id);


--
-- Name: advocate_availability uq_advocate_day_start; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.advocate_availability
    ADD CONSTRAINT uq_advocate_day_start UNIQUE (advocate_id, day_of_week, start_time);


--
-- Name: users uq_users_email; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT uq_users_email UNIQUE (email);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: idx_advocates_districts; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_advocates_districts ON public.advocates USING gin (districts);


--
-- Name: idx_advocates_languages; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_advocates_languages ON public.advocates USING gin (languages);


--
-- Name: idx_advocates_practice_areas; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_advocates_practice_areas ON public.advocates USING gin (practice_areas);


--
-- Name: idx_advocates_user_id; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_advocates_user_id ON public.advocates USING btree (user_id);


--
-- Name: idx_advocates_verification_status; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_advocates_verification_status ON public.advocates USING btree (verification_status);


--
-- Name: idx_ai_conv_citizen; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_ai_conv_citizen ON public.ai_conversation USING btree (citizen_id);


--
-- Name: idx_ai_conv_expires; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_ai_conv_expires ON public.ai_conversation USING btree (expires_at);


--
-- Name: idx_ai_conv_matter; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_ai_conv_matter ON public.ai_conversation USING btree (matter_id);


--
-- Name: idx_ai_conv_msg_conv; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_ai_conv_msg_conv ON public.ai_conversation_message USING btree (conversation_id, created_at);


--
-- Name: idx_ai_conv_session; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_ai_conv_session ON public.ai_conversation USING btree (session_id) WHERE (citizen_id IS NULL);


--
-- Name: idx_appt_advocate_id; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_appt_advocate_id ON public.consultation_appointment USING btree (advocate_id);


--
-- Name: idx_appt_consultation_id; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_appt_consultation_id ON public.consultation_appointment USING btree (consultation_id);


--
-- Name: idx_appt_scheduled_at; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_appt_scheduled_at ON public.consultation_appointment USING btree (scheduled_at);


--
-- Name: idx_avail_advocate_id; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_avail_advocate_id ON public.advocate_availability USING btree (advocate_id);


--
-- Name: idx_avail_day; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_avail_day ON public.advocate_availability USING btree (advocate_id, day_of_week) WHERE (is_active = true);


--
-- Name: idx_avd_advocate_id; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_avd_advocate_id ON public.advocate_verification_documents USING btree (advocate_id);


--
-- Name: idx_citizens_district; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_citizens_district ON public.citizens USING btree (district) WHERE (district IS NOT NULL);


--
-- Name: idx_citizens_user_id; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_citizens_user_id ON public.citizens USING btree (user_id);


--
-- Name: idx_consult_advocate; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_consult_advocate ON public.consultation_request USING btree (advocate_id, status);


--
-- Name: idx_consult_matter; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_consult_matter ON public.consultation_request USING btree (matter_id);


--
-- Name: idx_consult_status; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_consult_status ON public.consultation_request USING btree (status);


--
-- Name: idx_consultations_advocate_id; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_consultations_advocate_id ON public.consultations USING btree (advocate_id);


--
-- Name: idx_consultations_citizen_id; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_consultations_citizen_id ON public.consultations USING btree (citizen_id);


--
-- Name: idx_consultations_matter_id; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_consultations_matter_id ON public.consultations USING btree (matter_id);


--
-- Name: idx_consultations_status; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_consultations_status ON public.consultations USING btree (status);


--
-- Name: idx_documents_matter_id; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_documents_matter_id ON public.documents USING btree (matter_id);


--
-- Name: idx_documents_uploader_id; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_documents_uploader_id ON public.documents USING btree (uploader_id);


--
-- Name: idx_feedback_advocate_id; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_feedback_advocate_id ON public.consultation_feedback USING btree (advocate_id);


--
-- Name: idx_feedback_created_at; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_feedback_created_at ON public.consultation_feedback USING btree (created_at DESC);


--
-- Name: idx_ldu_embedding_ivfflat; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_ldu_embedding_ivfflat ON public.legal_document_unit USING ivfflat (embedding public.vector_cosine_ops) WITH (lists='50') WHERE (embedding IS NOT NULL);


--
-- Name: idx_ldu_fts_en; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_ldu_fts_en ON public.legal_document_unit USING gin (to_tsvector('english'::regconfig, ((((((COALESCE(doc_title, ''::text) || ' '::text) || COALESCE(node_label, ''::text)) || ' '::text) || COALESCE(citation_text, ''::text)) || ' '::text) || COALESCE(text_content, ''::text))));


--
-- Name: idx_legal_document_unit_jurisdiction; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_legal_document_unit_jurisdiction ON public.legal_document_unit USING btree (jurisdiction_level, state_code, court_code);


--
-- Name: idx_legal_document_unit_node; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_legal_document_unit_node ON public.legal_document_unit USING btree (node_type, node_label);


--
-- Name: idx_legal_document_unit_source; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_legal_document_unit_source ON public.legal_document_unit USING btree (source_id, source_type);


--
-- Name: idx_legal_unit_act_id; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_legal_unit_act_id ON public.legal_unit USING btree (act_id);


--
-- Name: idx_legal_unit_act_section; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_legal_unit_act_section ON public.legal_unit USING btree (act_id, section_number);


--
-- Name: idx_legal_unit_doc_type; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_legal_unit_doc_type ON public.legal_unit USING btree (doc_type);


--
-- Name: idx_legal_unit_jurisdiction; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_legal_unit_jurisdiction ON public.legal_unit USING btree (jurisdiction);


--
-- Name: idx_legal_unit_search_vector; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_legal_unit_search_vector ON public.legal_unit USING gin (search_vector);


--
-- Name: idx_legal_unit_section_number; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_legal_unit_section_number ON public.legal_unit USING btree (section_number);


--
-- Name: idx_lhe_child; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_lhe_child ON public.legal_hierarchy_edge USING btree (child_unit_id);


--
-- Name: idx_lhe_edge_type; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_lhe_edge_type ON public.legal_hierarchy_edge USING btree (edge_type);


--
-- Name: idx_matter_session_id; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_matter_session_id ON public.matter USING btree (session_id) WHERE (session_id IS NOT NULL);


--
-- Name: idx_matters_expires_at; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_matters_expires_at ON public.matters USING btree (expires_at) WHERE (expires_at IS NOT NULL);


--
-- Name: idx_matters_session_id; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_matters_session_id ON public.matters USING btree (session_id);


--
-- Name: idx_matters_status; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_matters_status ON public.matters USING btree (status);


--
-- Name: idx_matters_user_id; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_matters_user_id ON public.matters USING btree (user_id);


--
-- Name: idx_mbv_matter_id; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_mbv_matter_id ON public.matter_brief_version USING btree (matter_id);


--
-- Name: idx_mc_matter_id; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_mc_matter_id ON public.matter_citation USING btree (matter_id);


--
-- Name: idx_me_event_type; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_me_event_type ON public.matter_event USING btree (event_type);


--
-- Name: idx_me_matter_id; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_me_matter_id ON public.matter_event USING btree (matter_id);


--
-- Name: idx_messages_consultation_id; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_messages_consultation_id ON public.messages USING btree (consultation_id);


--
-- Name: idx_messages_created_at; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_messages_created_at ON public.messages USING btree (consultation_id, created_at);


--
-- Name: idx_msg_matter; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_msg_matter ON public.conversation_message USING btree (matter_id, created_at);


--
-- Name: idx_msg_request; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_msg_request ON public.conversation_message USING btree (request_id, created_at);


--
-- Name: idx_report_created; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_report_created ON public.citizen_report USING btree (created_at DESC);


--
-- Name: idx_report_status; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_report_status ON public.citizen_report USING btree (status);


--
-- Name: idx_users_email; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_users_email ON public.users USING btree (email) WHERE (email IS NOT NULL);


--
-- Name: idx_users_refresh_token; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_users_refresh_token ON public.users USING btree (refresh_token) WHERE (refresh_token IS NOT NULL);


--
-- Name: idx_users_role; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_users_role ON public.users USING btree (role);


--
-- Name: uq_appt_advocate_slot; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE UNIQUE INDEX uq_appt_advocate_slot ON public.consultation_appointment USING btree (advocate_id, scheduled_at) WHERE (status = 'scheduled'::text);


--
-- Name: uq_report_consultation; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE UNIQUE INDEX uq_report_consultation ON public.citizen_report USING btree (consultation_id);


--
-- Name: advocates trg_advocates_updated_at; Type: TRIGGER; Schema: public; Owner: neondb_owner
--

CREATE TRIGGER trg_advocates_updated_at BEFORE UPDATE ON public.advocates FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: citizens trg_citizens_updated_at; Type: TRIGGER; Schema: public; Owner: neondb_owner
--

CREATE TRIGGER trg_citizens_updated_at BEFORE UPDATE ON public.citizens FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: users trg_users_updated_at; Type: TRIGGER; Schema: public; Owner: neondb_owner
--

CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: advocate_availability advocate_availability_advocate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.advocate_availability
    ADD CONSTRAINT advocate_availability_advocate_id_fkey FOREIGN KEY (advocate_id) REFERENCES public.advocates(id) ON DELETE CASCADE;


--
-- Name: advocate_verification_documents advocate_verification_documents_advocate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.advocate_verification_documents
    ADD CONSTRAINT advocate_verification_documents_advocate_id_fkey FOREIGN KEY (advocate_id) REFERENCES public.advocates(id) ON DELETE CASCADE;


--
-- Name: advocates advocates_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.advocates
    ADD CONSTRAINT advocates_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: ai_conversation ai_conversation_citizen_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.ai_conversation
    ADD CONSTRAINT ai_conversation_citizen_fk FOREIGN KEY (citizen_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: ai_conversation ai_conversation_matter_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.ai_conversation
    ADD CONSTRAINT ai_conversation_matter_fk FOREIGN KEY (matter_id) REFERENCES public.matter(matter_id) ON DELETE SET NULL;


--
-- Name: ai_conversation_message ai_conversation_message_conv_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.ai_conversation_message
    ADD CONSTRAINT ai_conversation_message_conv_fk FOREIGN KEY (conversation_id) REFERENCES public.ai_conversation(conversation_id) ON DELETE CASCADE;


--
-- Name: citizen_report citizen_report_advocate_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.citizen_report
    ADD CONSTRAINT citizen_report_advocate_fk FOREIGN KEY (advocate_id) REFERENCES public.advocates(id) ON DELETE CASCADE;


--
-- Name: citizen_report citizen_report_citizen_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.citizen_report
    ADD CONSTRAINT citizen_report_citizen_fk FOREIGN KEY (citizen_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: citizen_report citizen_report_consultation_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.citizen_report
    ADD CONSTRAINT citizen_report_consultation_fk FOREIGN KEY (consultation_id) REFERENCES public.consultation_request(request_id) ON DELETE CASCADE;


--
-- Name: citizens citizens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.citizens
    ADD CONSTRAINT citizens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: consultation_appointment consultation_appointment_advocate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.consultation_appointment
    ADD CONSTRAINT consultation_appointment_advocate_id_fkey FOREIGN KEY (advocate_id) REFERENCES public.advocates(id) ON DELETE CASCADE;


--
-- Name: consultation_appointment consultation_appointment_consultation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.consultation_appointment
    ADD CONSTRAINT consultation_appointment_consultation_id_fkey FOREIGN KEY (consultation_id) REFERENCES public.consultation_request(request_id) ON DELETE CASCADE;


--
-- Name: consultation_feedback consultation_feedback_advocate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.consultation_feedback
    ADD CONSTRAINT consultation_feedback_advocate_id_fkey FOREIGN KEY (advocate_id) REFERENCES public.advocates(id) ON DELETE RESTRICT;


--
-- Name: consultation_feedback consultation_feedback_citizen_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.consultation_feedback
    ADD CONSTRAINT consultation_feedback_citizen_id_fkey FOREIGN KEY (citizen_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: consultation_feedback consultation_feedback_consultation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.consultation_feedback
    ADD CONSTRAINT consultation_feedback_consultation_id_fkey FOREIGN KEY (consultation_id) REFERENCES public.consultation_request(request_id) ON DELETE CASCADE;


--
-- Name: consultation_request consultation_request_advocate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.consultation_request
    ADD CONSTRAINT consultation_request_advocate_id_fkey FOREIGN KEY (advocate_id) REFERENCES public.advocates(id) ON DELETE RESTRICT;


--
-- Name: consultation_request consultation_request_matter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.consultation_request
    ADD CONSTRAINT consultation_request_matter_id_fkey FOREIGN KEY (matter_id) REFERENCES public.matter(matter_id);


--
-- Name: consultations consultations_advocate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.consultations
    ADD CONSTRAINT consultations_advocate_id_fkey FOREIGN KEY (advocate_id) REFERENCES public.advocates(id) ON DELETE RESTRICT;


--
-- Name: consultations consultations_citizen_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.consultations
    ADD CONSTRAINT consultations_citizen_id_fkey FOREIGN KEY (citizen_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: consultations consultations_matter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.consultations
    ADD CONSTRAINT consultations_matter_id_fkey FOREIGN KEY (matter_id) REFERENCES public.matters(id) ON DELETE RESTRICT;


--
-- Name: conversation_message conversation_message_matter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.conversation_message
    ADD CONSTRAINT conversation_message_matter_id_fkey FOREIGN KEY (matter_id) REFERENCES public.matter(matter_id);


--
-- Name: conversation_message conversation_message_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.conversation_message
    ADD CONSTRAINT conversation_message_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.consultation_request(request_id);


--
-- Name: documents documents_matter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_matter_id_fkey FOREIGN KEY (matter_id) REFERENCES public.matter(matter_id) ON DELETE CASCADE;


--
-- Name: documents documents_uploader_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_uploader_id_fkey FOREIGN KEY (uploader_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: legal_hierarchy_edge legal_hierarchy_edge_child_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.legal_hierarchy_edge
    ADD CONSTRAINT legal_hierarchy_edge_child_unit_id_fkey FOREIGN KEY (child_unit_id) REFERENCES public.legal_document_unit(unit_id) ON DELETE CASCADE;


--
-- Name: legal_hierarchy_edge legal_hierarchy_edge_parent_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.legal_hierarchy_edge
    ADD CONSTRAINT legal_hierarchy_edge_parent_unit_id_fkey FOREIGN KEY (parent_unit_id) REFERENCES public.legal_document_unit(unit_id) ON DELETE CASCADE;


--
-- Name: matter_advocate_shortlist matter_advocate_shortlist_advocate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.matter_advocate_shortlist
    ADD CONSTRAINT matter_advocate_shortlist_advocate_id_fkey FOREIGN KEY (advocate_id) REFERENCES public.advocates(id) ON DELETE CASCADE;


--
-- Name: matter_advocate_shortlist matter_advocate_shortlist_matter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.matter_advocate_shortlist
    ADD CONSTRAINT matter_advocate_shortlist_matter_id_fkey FOREIGN KEY (matter_id) REFERENCES public.matter(matter_id) ON DELETE CASCADE;


--
-- Name: matter_brief_version matter_brief_version_matter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.matter_brief_version
    ADD CONSTRAINT matter_brief_version_matter_id_fkey FOREIGN KEY (matter_id) REFERENCES public.matter(matter_id) ON DELETE CASCADE;


--
-- Name: matter_citation matter_citation_matter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.matter_citation
    ADD CONSTRAINT matter_citation_matter_id_fkey FOREIGN KEY (matter_id) REFERENCES public.matter(matter_id) ON DELETE CASCADE;


--
-- Name: matter_citation matter_citation_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.matter_citation
    ADD CONSTRAINT matter_citation_unit_id_fkey FOREIGN KEY (unit_id) REFERENCES public.legal_document_unit(unit_id) ON DELETE CASCADE;


--
-- Name: matter_event matter_event_matter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.matter_event
    ADD CONSTRAINT matter_event_matter_id_fkey FOREIGN KEY (matter_id) REFERENCES public.matter(matter_id) ON DELETE CASCADE;


--
-- Name: matters matters_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.matters
    ADD CONSTRAINT matters_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: messages messages_consultation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_consultation_id_fkey FOREIGN KEY (consultation_id) REFERENCES public.consultations(id) ON DELETE CASCADE;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: cloud_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE cloud_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO neon_superuser WITH GRANT OPTION;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: cloud_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE cloud_admin IN SCHEMA public GRANT ALL ON TABLES TO neon_superuser WITH GRANT OPTION;


--
-- PostgreSQL database dump complete
--

\unrestrict 8xFWAaVsiraiyHbiT6oCp4AYKdcPp6nYMysvorGJpIuHIMV83BP2puokQcDpOJo

