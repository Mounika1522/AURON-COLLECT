const formatLabel = (value, fallback = '') => {
  if (!value) return fallback;

  return String(value)
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
};

export const mapCustomer = (customer) => ({
  id: customer.id,
  name: customer.name,
  code: customer.customerCode || '',
  type: customer.type || 'BUSINESS',
  contactPerson: customer.contactPerson || '',
  email: customer.email || '',
  phone: customer.phone || '',
  gstin: customer.taxRegistration || '',
  billingAddress: customer.billingAddress || '',
  shippingAddress: customer.shippingAddress || '',
  creditLimit: Number(customer.creditLimit || 0),
  paymentTerms: customer.paymentTerms || '',
  riskRating: formatLabel(customer.riskLevel, 'Low'),
  status: customer.status || '',
  notes: customer.notes || '',
  branch: '',
  category: '',
  executive: '',
});

export const mapInvoice = (invoice) => ({
  id: invoice.id,
  invoiceNumber: invoice.invoiceNumber,
  customerId: invoice.customerId,
  customerName: invoice.customer?.name || '',
  invoiceDate: invoice.invoiceDate?.slice(0, 10) || '',
  dueDate: invoice.dueDate?.slice(0, 10) || '',
  subtotal: Number(invoice.subtotal || 0),
  totalAmount: Number(invoice.total || 0),
  taxAmount: Number(invoice.tax || 0),
  discount: Number(invoice.discount || 0),
  currency: String(invoice.currency || 'INR').trim().toUpperCase(),
  status: invoice.status || 'DRAFT',
  assignedExecutive: invoice.assignedExecutive || '',
  executive: invoice.assignedExecutive || '',
  branch: '',
  category: '',
});

export const mapReceipt = (receipt) => ({
  id: receipt.id,
  receiptNumber: receipt.receiptNumber,
  customerId: receipt.customerId,
  customerName: receipt.customer?.name || '',
  date: receipt.receiptDate?.slice(0, 10) || '',
  dateTime: receipt.receiptDate || '',
  amount: Number(receipt.amount || 0),
  currency: String(receipt.currency || '').trim().toUpperCase(),
  mode: receipt.paymentMethod || '',
  reference: receipt.transactionReference || '',
  status: formatLabel(receipt.status, 'Posted'),
  allocations: (receipt.allocations || []).map((allocation) => ({
    id: allocation.id,
    invoiceId: allocation.invoiceId,
    amount: Number(allocation.amount || 0),
    status: allocation.status,
    reversedAt: allocation.reversedAt || null,
  })),
});

export const mapTask = (task) => ({
  id: task.id,
  customerId: task.customerId,
  customerName: task.customer?.name || '',
  title: task.title,
  description: task.description || '',
  dueDate: task.dueDate?.slice(0, 10) || '',
  priority: formatLabel(task.priority, 'Medium'),
  priorityCode: task.priority || 'MEDIUM',
  assignee: task.assignedExecutive || '',
  status: formatLabel(task.status, 'Pending'),
  statusCode: task.status || 'PENDING',
  outcome: task.outcome || '',
});

export const mapPromise = (promise) => ({
  id: promise.id,
  customerId: promise.customerId,
  customerName: promise.customer?.name || '',
  invoiceId: promise.invoiceId,
  promisedAmount: Number(promise.promisedAmount || 0),
  currency: String(promise.invoice?.currency || '').trim().toUpperCase(),
  promisedDate: promise.promisedDate?.slice(0, 10) || '',
  createdAt: promise.createdAt || '',
  createdDate: promise.createdAt?.slice(0, 10) || '',
  notes: promise.notes || '',
  executive: promise.recordedBy || '',
  status: promise.status || 'PROMISED',
});

export const mapDispute = (dispute) => ({
  id: dispute.id,
  customerId: dispute.customerId,
  customerName: dispute.customer?.name || '',
  invoiceId: dispute.invoiceId,
  disputedAmount: Number(dispute.disputedAmount || 0),
  category: dispute.reason || '',
  status: formatLabel(dispute.status, 'Open'),
  createdDate: dispute.createdAt?.slice(0, 10) || '',
  notes: dispute.description || '',
  resolution: dispute.resolution || '',
});

export const mapCreditAdjustment = (adjustment) => ({
  id: adjustment.id,
  adjustmentNumber: adjustment.adjustmentNumber,
  invoiceId: adjustment.invoiceId,
  invoiceNumber: adjustment.invoice?.invoiceNumber || '',
  amount: Number(adjustment.amount || 0),
  reason: adjustment.reason || '',
  status: formatLabel(adjustment.status, 'Pending'),
  date: adjustment.createdAt?.slice(0, 10) || '',
});

export const mapCommunication = (communication) => ({
  id: communication.id,
  customer: communication.customer?.name || '',
  customerId: communication.customerId,
  invoiceId: communication.invoiceId || '',
  channel: formatLabel(communication.channel, 'Other'),
  gateway: '',
  status: formatLabel(communication.deliveryStatus || communication.direction, 'Recorded'),
  timestamp: communication.occurredAt || communication.createdAt || '',
  trigger: communication.direction || 'Manual',
  message: communication.message || '',
});

export const mapReminder = (reminder) => ({
  id: reminder.id,
  customerId: reminder.customerId,
  customerName: reminder.customer?.name || '',
  invoiceId: reminder.invoiceId || '',
  channel: reminder.channel,
  status: formatLabel(reminder.status, 'Pending'),
  deliveryStatus: formatLabel(reminder.deliveryStatus, 'Pending'),
  scheduledFor: reminder.scheduledFor,
  sentAt: reminder.sentAt,
  subject: reminder.subject || '',
  message: reminder.message || '',
});
