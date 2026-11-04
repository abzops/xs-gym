export type Role = 'owner' | 'manager' | 'reception' | 'trainer';
export type Method = 'cash' | 'upi' | 'card' | 'bank' | 'other';
export type MembershipStatus = 'active' | 'grace' | 'expired' | 'upcoming' | 'cancelled' | 'none';

export type Gym = {
  id: string; name: string; slug: string; timezone: string; currency: 'INR';
  phone: string | null; email: string | null; address: string | null;
  grace_days: number; status: 'active' | 'suspended'; created_at: string;
};

export type StaffRow = {
  id: string; gym_id: string; user_id: string; role: Role; status: 'active' | 'inactive';
  display_name: string | null; email: string | null; created_at: string;
};

export type Subscription = {
  gym_id: string; plan: 'starter' | 'growth' | 'max'; status: 'trial' | 'active' | 'suspended';
  trial_started_at: string | null; trial_ends_at: string | null; paid_until: string | null;
};

export type MemberOverview = {
  id: string; gym_id: string; member_no: string; full_name: string; phone: string; email: string | null;
  gender: 'male' | 'female' | 'other' | null; date_of_birth: string | null; address: string | null;
  emergency_contact: string | null; join_date: string; status: 'active' | 'archived'; created_at: string;
  membership_id: string | null; plan_name: string | null; start_date: string | null; end_date: string | null;
  valid_until: string | null; membership_status: MembershipStatus;
  due_paise: number; credit_paise: number; last_check_in_at: string | null;
};

export type Plan = {
  id: string; gym_id: string; name: string; duration_unit: 'day' | 'month'; duration_count: number;
  price_paise: number; description: string | null; status: 'active' | 'archived';
};

export type Membership = {
  id: string; member_id: string; plan_id: string; plan_name: string; start_date: string; end_date: string;
  price_paise: number; status: 'active' | 'cancelled'; cancel_reason: string | null; created_at: string;
};

export type Charge = {
  id: string; member_id: string; membership_id: string | null; kind: 'membership' | 'admission' | 'other';
  description: string; gross_paise: number; discount_paise: number; net_paise: number;
  discount_reason: string | null; due_date: string; status: 'open' | 'void'; void_reason: string | null; created_at: string;
};

export type Payment = {
  id: string; gym_id: string; member_id: string; amount_paise: number; method: Method; received_at: string;
  reference: string | null; notes: string | null; received_by: string | null;
  payment_reversals?: { id: string; reason: string; reversed_at: string }[];
  members?: { full_name: string; member_no: string } | null;
};

export type Attendance = {
  id: string; member_id: string; checked_in_at: string; membership_status: string;
  override_reason: string | null; voided_at: string | null; void_reason: string | null;
  members?: { full_name: string; member_no: string } | null;
};

export type Expense = {
  id: string; amount_paise: number; expense_date: string; method: Method; description: string | null; created_at: string;
  expense_categories?: { name: string } | null;
  expense_reversals?: { id: string; reason: string }[];
};

export const METHOD_LABEL: Record<Method, string> = { cash: 'Cash', upi: 'UPI', card: 'Card', bank: 'Bank transfer', other: 'Other' };
export const ROLE_LABEL: Record<Role, string> = { owner: 'Owner', manager: 'Manager', reception: 'Reception', trainer: 'Trainer' };
