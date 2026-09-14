'use client';

import { useRouter } from 'next/navigation';
import { Modal } from '../Modal';

export interface EmployeeDetailModalProps {
  title: string;
  description: string;
  children: React.ReactNode;
}

/**
 * The dialog frame the intercepted employee route renders into.
 *
 * Closing goes back rather than clearing local state, because the URL is what
 * opened the dialog - so Escape, the backdrop and the browser's back button
 * all land in the same place, and the link is still shareable.
 */
export function EmployeeDetailModal({ title, description, children }: EmployeeDetailModalProps) {
  const router = useRouter();

  return (
    <Modal
      open
      onClose={() => router.back()}
      title={title}
      description={description}
      width="max-w-6xl"
      bodyClassName="rounded-b-lg bg-canvas px-5 py-5 sm:px-6"
    >
      {children}
    </Modal>
  );
}
