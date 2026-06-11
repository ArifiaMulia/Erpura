/**
 * test-data.js - Realistic Test Data for the Odoo Code Analyzer
 *
 * Contains a complete Odoo module ('custom_sales') with intentional errors
 * and anti-patterns for validating the analyzer's detection capabilities.
 *
 * Exposed as: window.OdooAnalyzer.TestData
 * API:
 *   - getTestFiles()       → Array<FileEntry>  { name, path, type, content }
 *   - getExpectedResults()  → ExpectedResults object
 */

window.OdooAnalyzer = window.OdooAnalyzer || {};

window.OdooAnalyzer.TestData = (function () {
    'use strict';

    // =========================================================================
    //  FILE CONTENTS — each constant holds one module file
    // =========================================================================

    // -- 1. __manifest__.py ---------------------------------------------------
    // INTENTIONAL ERROR: missing 'license' key (required for Odoo 14+)
    const MANIFEST_CONTENT = `{
    'name': 'Custom Sales Module',
    'version': '14.0.1.0.0',
    'category': 'Sales',
    'summary': 'Custom sales enhancements with approval workflow',
    'description': """
        Custom Sales Module
        ===================
        This module provides custom enhancements to the standard Odoo Sales module.

        Features:
        - Discount approval workflow
        - Priority level management
        - Custom sales reports
        - Inventory check integration
    """,
    'author': 'Custom Dev Team',
    'website': 'https://example.com',
    'depends': ['sale', 'stock', 'account'],
    'data': [
        'security/security.xml',
        'security/ir.model.access.csv',
        'views/sale_order_views.xml',
        'views/custom_report_views.xml',
        'views/inventory_check_views.xml',
    ],
    'installable': True,
    'application': False,
    'auto_install': False,
}`;

    // -- 2. __init__.py -------------------------------------------------------
    const INIT_CONTENT = `from . import models`;

    // -- 3. models/__init__.py ------------------------------------------------
    const MODELS_INIT_CONTENT = `from . import sale_order
from . import custom_report
from . import inventory_check`;

    // -- 4. models/sale_order.py ----------------------------------------------
    // INTENTIONAL ERRORS:
    //   - Computed field without store=True
    //   - @api.multi (deprecated Odoo 13+)
    //   - Missing super() call in write override
    //   - SQL Injection via string interpolation
    //   - browse() with hardcoded ID
    //   - Bare except clause
    //   - search() inside a for loop (N+1 performance issue)
    const SALE_ORDER_CONTENT = `# -*- coding: utf-8 -*-
from odoo import models, fields, api, _
from odoo.exceptions import UserError, ValidationError
import logging

_logger = logging.getLogger(__name__)


class SaleOrderCustom(models.Model):
    _inherit = 'sale.order'
    _description = 'Custom Sale Order'

    discount_approval = fields.Boolean(
        string='Discount Approval Required',
        default=False,
        help='If checked, discount needs manager approval'
    )
    custom_notes = fields.Text(
        string='Internal Notes',
        help='Internal notes for this order'
    )
    priority_level = fields.Selection([
        ('low', 'Low'),
        ('medium', 'Medium'),
        ('high', 'High'),
        ('urgent', 'Urgent'),
    ], string='Priority Level', default='medium')
    
    approved_by = fields.Many2one(
        'res.users',
        string='Approved By',
        readonly=True
    )
    approval_date = fields.Datetime(
        string='Approval Date',
        readonly=True
    )
    total_discount = fields.Float(
        string='Total Discount',
        compute='_compute_total_discount'
    )

    # ERROR: Missing store=True for computed field used in search
    @api.depends('order_line.discount')
    def _compute_total_discount(self):
        for order in self:
            order.total_discount = sum(line.discount for line in order.order_line)

    # ERROR: @api.multi is deprecated in Odoo 13+
    @api.multi
    def action_request_approval(self):
        for order in self:
            if order.total_discount > 20:
                order.discount_approval = True
                # Send notification
                template = self.env.ref('custom_sales.email_template_approval')
                template.send_mail(order.id, force_send=True)
            else:
                order.action_confirm()

    def action_approve(self):
        self.ensure_one()
        self.write({
            'discount_approval': False,
            'approved_by': self.env.user.id,
            'approval_date': fields.Datetime.now(),
        })
        self.action_confirm()
        return True

    def action_reject(self):
        self.ensure_one()
        self.write({
            'state': 'draft',
            'discount_approval': False,
        })
        # Send rejection notification
        self.message_post(
            body=_('Order rejected by %s') % self.env.user.name,
            message_type='notification'
        )

    # ERROR: Missing super() call in write override
    def write(self, vals):
        if 'state' in vals and vals['state'] == 'sale':
            for rec in self:
                if rec.discount_approval:
                    raise UserError(_('Order needs approval before confirmation!'))
        # Missing: return super().write(vals)
        return True

    # ERROR: SQL Injection vulnerability
    def get_custom_report_data(self):
        query = "SELECT id, name, amount_total FROM sale_order WHERE partner_id = %s" % self.partner_id.id
        self.env.cr.execute(query)
        return self.env.cr.dictfetchall()

    # ERROR: browse with hardcoded ID
    def get_default_warehouse(self):
        return self.env['stock.warehouse'].browse(1)

    # ERROR: bare except
    def safe_compute_tax(self):
        try:
            self._amount_all()
        except:
            pass

    # ERROR: search inside for loop (performance issue)
    def update_all_lines(self):
        for line in self.order_line:
            product = self.env['product.product'].search([
                ('id', '=', line.product_id.id)
            ])
            line.write({'name': product.name})`;

    // -- 5. models/custom_report.py -------------------------------------------
    // INTENTIONAL ERRORS:
    //   - Missing _description on custom.sales.report
    //   - Old-style field declaration (fields.char lowercase)
    //   - Many2one without ondelete
    //   - Computed field without store
    //   - self.env.cr.commit() usage
    const CUSTOM_REPORT_CONTENT = `# -*- coding: utf-8 -*-
from odoo import models, fields, api


class CustomSalesReport(models.Model):
    _name = 'custom.sales.report'
    # ERROR: Missing _description

    # ERROR: old-style field declaration (lowercase)
    name = fields.char('Report Name', required=True)
    
    report_date = fields.Date(
        string='Report Date',
        default=fields.Date.today
    )
    sale_order_id = fields.Many2one(
        'sale.order',
        string='Sale Order',
        # ERROR: Missing ondelete
    )
    partner_id = fields.Many2one(
        'res.partner',
        string='Customer',
        related='sale_order_id.partner_id',
        store=True
    )
    total_amount = fields.Float(
        string='Total Amount',
        # ERROR: computed without store
        compute='_compute_total_amount'
    )
    report_type = fields.Selection([
        ('daily', 'Daily'),
        ('weekly', 'Weekly'),
        ('monthly', 'Monthly'),
    ], string='Report Type', default='daily')
    
    line_ids = fields.One2many(
        'custom.sales.report.line',
        'report_id',
        string='Report Lines'
    )
    
    notes = fields.Text('Notes')
    active = fields.Boolean('Active', default=True)
    state = fields.Selection([
        ('draft', 'Draft'),
        ('confirmed', 'Confirmed'),
        ('done', 'Done'),
    ], string='Status', default='draft')

    @api.depends('line_ids.amount')
    def _compute_total_amount(self):
        for report in self:
            report.total_amount = sum(line.amount for line in report.line_ids)

    # ERROR: self.env.cr.commit() usage
    def action_confirm(self):
        self.write({'state': 'confirmed'})
        self.env.cr.commit()

    def action_done(self):
        self.write({'state': 'done'})


class CustomSalesReportLine(models.Model):
    _name = 'custom.sales.report.line'
    _description = 'Custom Sales Report Line'

    report_id = fields.Many2one(
        'custom.sales.report',
        string='Report',
        ondelete='cascade'
    )
    product_id = fields.Many2one(
        'product.product',
        string='Product',
        required=True
    )
    quantity = fields.Float('Quantity', default=1.0)
    price_unit = fields.Float('Unit Price')
    amount = fields.Float(
        'Amount',
        compute='_compute_amount',
        store=True
    )

    @api.depends('quantity', 'price_unit')
    def _compute_amount(self):
        for line in self:
            line.amount = line.quantity * line.price_unit`;

    // -- 6. models/inventory_check.py -----------------------------------------
    // INTENTIONAL ERROR: Missing _description on inventory.check
    const INVENTORY_CHECK_CONTENT = `# -*- coding: utf-8 -*-
from odoo import models, fields, api, _
from odoo.exceptions import UserError


class InventoryCheck(models.Model):
    _name = 'inventory.check'
    # ERROR: Missing _description

    name = fields.Char(
        string='Reference',
        required=True,
        copy=False,
        readonly=True,
        default=lambda self: _('New')
    )
    check_date = fields.Date(
        string='Check Date',
        default=fields.Date.today,
        required=True
    )
    warehouse_id = fields.Many2one(
        'stock.warehouse',
        string='Warehouse',
        required=True
    )
    responsible_id = fields.Many2one(
        'res.users',
        string='Responsible',
        default=lambda self: self.env.user
    )
    state = fields.Selection([
        ('draft', 'Draft'),
        ('checking', 'In Progress'),
        ('done', 'Completed'),
        ('cancelled', 'Cancelled'),
    ], string='Status', default='draft', tracking=True)
    
    line_ids = fields.One2many(
        'inventory.check.line',
        'check_id',
        string='Check Lines'
    )
    notes = fields.Text('Notes')
    
    _sql_constraints = [
        ('name_unique', 'unique(name)', 'Reference must be unique!'),
    ]

    @api.model
    def create(self, vals):
        if vals.get('name', _('New')) == _('New'):
            vals['name'] = self.env['ir.sequence'].next_by_code('inventory.check') or _('New')
        return super(InventoryCheck, self).create(vals)

    def action_start_check(self):
        self.ensure_one()
        if self.state != 'draft':
            raise UserError(_('Only draft checks can be started.'))
        self.write({'state': 'checking'})

    def action_complete(self):
        self.ensure_one()
        if self.state != 'checking':
            raise UserError(_('Only in-progress checks can be completed.'))
        self.write({'state': 'done'})

    def action_cancel(self):
        self.ensure_one()
        if self.state == 'done':
            raise UserError(_('Completed checks cannot be cancelled.'))
        self.write({'state': 'cancelled'})

    def action_reset_draft(self):
        self.ensure_one()
        if self.state != 'cancelled':
            raise UserError(_('Only cancelled checks can be reset to draft.'))
        self.write({'state': 'draft'})


class InventoryCheckLine(models.Model):
    _name = 'inventory.check.line'
    _description = 'Inventory Check Line'

    check_id = fields.Many2one(
        'inventory.check',
        string='Inventory Check',
        ondelete='cascade',
        required=True
    )
    product_id = fields.Many2one(
        'product.product',
        string='Product',
        required=True
    )
    expected_qty = fields.Float('Expected Quantity')
    actual_qty = fields.Float('Actual Quantity')
    difference = fields.Float(
        'Difference',
        compute='_compute_difference',
        store=True
    )
    location_id = fields.Many2one(
        'stock.location',
        string='Location'
    )

    @api.depends('expected_qty', 'actual_qty')
    def _compute_difference(self):
        for line in self:
            line.difference = line.actual_qty - line.expected_qty`;

    // -- 7. views/sale_order_views.xml ----------------------------------------
    const SALE_ORDER_VIEWS_CONTENT = `<?xml version="1.0" encoding="utf-8"?>
<odoo>
    <data>
        <!-- Form view: inherit sale.order and add custom fields -->
        <record id="view_order_form_custom" model="ir.ui.view">
            <field name="name">sale.order.form.custom</field>
            <field name="model">sale.order</field>
            <field name="inherit_id" ref="sale.view_order_form"/>
            <field name="arch" type="xml">
                <xpath expr="//field[@name='payment_term_id']" position="after">
                    <field name="priority_level"/>
                    <field name="discount_approval" readonly="1"/>
                    <field name="total_discount"/>
                </xpath>
                <xpath expr="//group[@name='sale_info']" position="inside">
                    <field name="approved_by"/>
                    <field name="approval_date"/>
                </xpath>
                <xpath expr="//field[@name='note']" position="before">
                    <field name="custom_notes" placeholder="Internal notes..."/>
                </xpath>
                <xpath expr="//header" position="inside">
                    <button name="action_request_approval"
                            string="Request Approval"
                            type="object"
                            class="btn-primary"
                            attrs="{'invisible': [('discount_approval', '=', True)]}"/>
                    <button name="action_approve"
                            string="Approve"
                            type="object"
                            class="btn-success"
                            groups="custom_sales.group_discount_manager"
                            attrs="{'invisible': [('discount_approval', '=', False)]}"/>
                    <button name="action_reject"
                            string="Reject"
                            type="object"
                            class="btn-danger"
                            groups="custom_sales.group_discount_manager"
                            attrs="{'invisible': [('discount_approval', '=', False)]}"/>
                </xpath>
            </field>
        </record>

        <!-- Tree view: inherit sale.order tree -->
        <record id="view_order_tree_custom" model="ir.ui.view">
            <field name="name">sale.order.tree.custom</field>
            <field name="model">sale.order</field>
            <field name="inherit_id" ref="sale.view_order_tree"/>
            <field name="arch" type="xml">
                <xpath expr="//field[@name='amount_total']" position="after">
                    <field name="priority_level"/>
                    <field name="total_discount"/>
                </xpath>
            </field>
        </record>

        <!-- Search view -->
        <record id="view_order_search_custom" model="ir.ui.view">
            <field name="name">sale.order.search.custom</field>
            <field name="model">sale.order</field>
            <field name="inherit_id" ref="sale.sale_order_view_search_inherit_sale"/>
            <field name="arch" type="xml">
                <xpath expr="//search" position="inside">
                    <filter name="filter_high_priority"
                            string="High Priority"
                            domain="[('priority_level', 'in', ['high', 'urgent'])]"/>
                    <filter name="filter_needs_approval"
                            string="Needs Approval"
                            domain="[('discount_approval', '=', True)]"/>
                    <separator/>
                    <group expand="0" string="Group By">
                        <filter name="group_priority"
                                string="Priority"
                                context="{'group_by': 'priority_level'}"/>
                    </group>
                </xpath>
            </field>
        </record>

        <!-- Action window -->
        <record id="action_custom_sale_orders" model="ir.actions.act_window">
            <field name="name">Custom Sales Orders</field>
            <field name="res_model">sale.order</field>
            <field name="view_mode">tree,form</field>
            <field name="context">{'default_priority_level': 'medium'}</field>
            <field name="help" type="html">
                <p class="o_view_nocontent_smiling_face">
                    Create a new sale order
                </p>
            </field>
        </record>

        <!-- Menu items: Sales > Custom Sales > Orders -->
        <menuitem id="menu_custom_sales_root"
                  name="Custom Sales"
                  parent="sale.sale_menu_root"
                  sequence="5"/>

        <menuitem id="menu_custom_sales_orders"
                  name="Orders"
                  parent="menu_custom_sales_root"
                  action="action_custom_sale_orders"
                  sequence="10"/>
    </data>
</odoo>`;

    // -- 8. views/custom_report_views.xml -------------------------------------
    const CUSTOM_REPORT_VIEWS_CONTENT = `<?xml version="1.0" encoding="utf-8"?>
<odoo>
    <data>
        <!-- Form view for custom.sales.report -->
        <record id="view_custom_sales_report_form" model="ir.ui.view">
            <field name="name">custom.sales.report.form</field>
            <field name="model">custom.sales.report</field>
            <field name="arch" type="xml">
                <form string="Sales Report">
                    <header>
                        <button name="action_confirm"
                                string="Confirm"
                                type="object"
                                class="btn-primary"
                                states="draft"/>
                        <button name="action_done"
                                string="Mark as Done"
                                type="object"
                                class="btn-success"
                                states="confirmed"/>
                        <field name="state" widget="statusbar"
                               statusbar_visible="draft,confirmed,done"/>
                    </header>
                    <sheet>
                        <div class="oe_title">
                            <h1>
                                <field name="name" placeholder="Report Name"/>
                            </h1>
                        </div>
                        <group>
                            <group>
                                <field name="report_date"/>
                                <field name="report_type"/>
                                <field name="sale_order_id"/>
                            </group>
                            <group>
                                <field name="partner_id"/>
                                <field name="total_amount"/>
                                <field name="active"/>
                            </group>
                        </group>
                        <notebook>
                            <page string="Report Lines">
                                <field name="line_ids">
                                    <tree editable="bottom">
                                        <field name="product_id"/>
                                        <field name="quantity"/>
                                        <field name="price_unit"/>
                                        <field name="amount"/>
                                    </tree>
                                </field>
                            </page>
                            <page string="Notes">
                                <field name="notes" placeholder="Additional notes..."/>
                            </page>
                        </notebook>
                    </sheet>
                </form>
            </field>
        </record>

        <!-- Tree view for custom.sales.report -->
        <record id="view_custom_sales_report_tree" model="ir.ui.view">
            <field name="name">custom.sales.report.tree</field>
            <field name="model">custom.sales.report</field>
            <field name="arch" type="xml">
                <tree string="Sales Reports"
                      decoration-info="state == 'draft'"
                      decoration-success="state == 'done'"
                      decoration-warning="state == 'confirmed'">
                    <field name="name"/>
                    <field name="report_date"/>
                    <field name="report_type"/>
                    <field name="partner_id"/>
                    <field name="total_amount"/>
                    <field name="state"/>
                </tree>
            </field>
        </record>

        <!-- Action window -->
        <record id="action_custom_sales_report" model="ir.actions.act_window">
            <field name="name">Sales Reports</field>
            <field name="res_model">custom.sales.report</field>
            <field name="view_mode">tree,form</field>
            <field name="help" type="html">
                <p class="o_view_nocontent_smiling_face">
                    Create your first sales report
                </p>
            </field>
        </record>

        <!-- Menu items -->
        <menuitem id="menu_custom_sales_reports"
                  name="Reports"
                  parent="menu_custom_sales_root"
                  action="action_custom_sales_report"
                  sequence="20"/>
    </data>
</odoo>`;

    // -- 9. views/inventory_check_views.xml -----------------------------------
    const INVENTORY_CHECK_VIEWS_CONTENT = `<?xml version="1.0" encoding="utf-8"?>
<odoo>
    <data>
        <!-- Form view for inventory.check -->
        <record id="view_inventory_check_form" model="ir.ui.view">
            <field name="name">inventory.check.form</field>
            <field name="model">inventory.check</field>
            <field name="arch" type="xml">
                <form string="Inventory Check">
                    <header>
                        <button name="action_start_check"
                                string="Start Check"
                                type="object"
                                class="btn-primary"
                                states="draft"/>
                        <button name="action_complete"
                                string="Complete"
                                type="object"
                                class="btn-success"
                                states="checking"/>
                        <button name="action_cancel"
                                string="Cancel"
                                type="object"
                                class="btn-danger"
                                states="draft,checking"/>
                        <button name="action_reset_draft"
                                string="Reset to Draft"
                                type="object"
                                states="cancelled"/>
                        <field name="state" widget="statusbar"
                               statusbar_visible="draft,checking,done"/>
                    </header>
                    <sheet>
                        <div class="oe_title">
                            <h1>
                                <field name="name" readonly="1"/>
                            </h1>
                        </div>
                        <group>
                            <group>
                                <field name="check_date"/>
                                <field name="warehouse_id"/>
                            </group>
                            <group>
                                <field name="responsible_id"/>
                            </group>
                        </group>
                        <notebook>
                            <page string="Check Lines">
                                <field name="line_ids">
                                    <tree editable="bottom">
                                        <field name="product_id"/>
                                        <field name="location_id"/>
                                        <field name="expected_qty"/>
                                        <field name="actual_qty"/>
                                        <field name="difference"/>
                                    </tree>
                                </field>
                            </page>
                            <page string="Notes">
                                <field name="notes" placeholder="Notes..."/>
                            </page>
                        </notebook>
                    </sheet>
                </form>
            </field>
        </record>

        <!-- Tree view for inventory.check -->
        <record id="view_inventory_check_tree" model="ir.ui.view">
            <field name="name">inventory.check.tree</field>
            <field name="model">inventory.check</field>
            <field name="arch" type="xml">
                <tree string="Inventory Checks"
                      decoration-info="state == 'draft'"
                      decoration-warning="state == 'checking'"
                      decoration-success="state == 'done'"
                      decoration-danger="state == 'cancelled'">
                    <field name="name"/>
                    <field name="check_date"/>
                    <field name="warehouse_id"/>
                    <field name="responsible_id"/>
                    <field name="state"/>
                </tree>
            </field>
        </record>

        <!-- Action window -->
        <record id="action_inventory_check" model="ir.actions.act_window">
            <field name="name">Inventory Checks</field>
            <field name="res_model">inventory.check</field>
            <field name="view_mode">tree,form</field>
            <field name="help" type="html">
                <p class="o_view_nocontent_smiling_face">
                    Create a new inventory check
                </p>
            </field>
        </record>

        <!-- Menu items -->
        <menuitem id="menu_inventory_checks"
                  name="Inventory Checks"
                  parent="menu_custom_sales_root"
                  action="action_inventory_check"
                  sequence="30"/>
    </data>
</odoo>`;

    // -- 10. security/ir.model.access.csv -------------------------------------
    // INTENTIONAL ERROR: Missing access rights for inventory.check and inventory.check.line
    const ACCESS_CSV_CONTENT = `id,name,model_id:id,group_id:id,perm_read,perm_write,perm_create,perm_unlink
access_custom_sales_report,custom.sales.report,model_custom_sales_report,sales_team.group_sale_manager,1,1,1,1
access_custom_sales_report_user,custom.sales.report.user,model_custom_sales_report,sales_team.group_sale_salesman,1,1,1,0
access_custom_sales_report_line,custom.sales.report.line,model_custom_sales_report_line,sales_team.group_sale_salesman,1,1,1,0`;

    // -- 11. security/security.xml --------------------------------------------
    const SECURITY_XML_CONTENT = `<?xml version="1.0" encoding="utf-8"?>
<odoo>
    <data noupdate="1">
        <record id="group_discount_manager" model="res.groups">
            <field name="name">Discount Manager</field>
            <field name="category_id" ref="base.module_category_sales"/>
        </record>

        <record id="rule_custom_report_own" model="ir.rule">
            <field name="name">Custom Report: Own Only</field>
            <field name="model_id" ref="model_custom_sales_report"/>
            <field name="domain_force">[('create_uid', '=', user.id)]</field>
            <field name="groups" eval="[(4, ref('sales_team.group_sale_salesman'))]"/>
        </record>
    </data>
</odoo>`;

    // -- 12. tests/test_sales.py ----------------------------------------------
    const TESTS_SALES_CONTENT = `# -*- coding: utf-8 -*-
from odoo.tests import common

class TestCustomSales(common.TransactionCase):
    def setUp(self):
        super(TestCustomSales, self).setUp()
        self.partner = self.env['res.partner'].create({'name': 'Test Partner'})

    def test_discount_approval(self):
        """Test that discount approval flag behaves correctly"""
        order = self.env['sale.order'].create({
            'partner_id': self.partner.id,
            'discount_approval': True,
        })
        self.assertTrue(order.discount_approval)

    def test_inventory_check_workflow(self):
        """Test state transitions of inventory check"""
        check = self.env['inventory.check'].create({
            'name': 'Check 1',
        })
        self.assertEqual(check.state, 'draft')
        check.action_start_check()
        self.assertEqual(check.state, 'checking')
        check.action_complete()
        self.assertEqual(check.state, 'done')`;


    // =========================================================================
    //  getTestFiles()
    //  Returns an array of FileEntry objects: { name, path, type, content }
    // =========================================================================
    function getTestFiles() {
        return [
            {
                name: '__manifest__.py',
                path: 'custom_sales/__manifest__.py',
                type: 'python',
                content: MANIFEST_CONTENT
            },
            {
                name: '__init__.py',
                path: 'custom_sales/__init__.py',
                type: 'python',
                content: INIT_CONTENT
            },
            {
                name: '__init__.py',
                path: 'custom_sales/models/__init__.py',
                type: 'python',
                content: MODELS_INIT_CONTENT
            },
            {
                name: 'sale_order.py',
                path: 'custom_sales/models/sale_order.py',
                type: 'python',
                content: SALE_ORDER_CONTENT
            },
            {
                name: 'custom_report.py',
                path: 'custom_sales/models/custom_report.py',
                type: 'python',
                content: CUSTOM_REPORT_CONTENT
            },
            {
                name: 'inventory_check.py',
                path: 'custom_sales/models/inventory_check.py',
                type: 'python',
                content: INVENTORY_CHECK_CONTENT
            },
            {
                name: 'sale_order_views.xml',
                path: 'custom_sales/views/sale_order_views.xml',
                type: 'xml',
                content: SALE_ORDER_VIEWS_CONTENT
            },
            {
                name: 'custom_report_views.xml',
                path: 'custom_sales/views/custom_report_views.xml',
                type: 'xml',
                content: CUSTOM_REPORT_VIEWS_CONTENT
            },
            {
                name: 'inventory_check_views.xml',
                path: 'custom_sales/views/inventory_check_views.xml',
                type: 'xml',
                content: INVENTORY_CHECK_VIEWS_CONTENT
            },
            {
                name: 'ir.model.access.csv',
                path: 'custom_sales/security/ir.model.access.csv',
                type: 'csv',
                content: ACCESS_CSV_CONTENT
            },
            {
                name: 'security.xml',
                path: 'custom_sales/security/security.xml',
                type: 'xml',
                content: SECURITY_XML_CONTENT
            },
            {
                name: 'test_sales.py',
                path: 'custom_sales/tests/test_sales.py',
                type: 'python',
                content: TESTS_SALES_CONTENT
            }
        ];
    }


    // =========================================================================
    //  getExpectedResults()
    //  Returns an object describing what the analyzer should detect.
    //  Descriptions are in Indonesian.
    // =========================================================================
    function getExpectedResults() {
        return {
            summary:
                'Modul custom_sales berisi 3 model utama (sale.order inherit, custom.sales.report, inventory.check) ' +
                'dengan berbagai masalah kode termasuk kerentanan SQL Injection, penggunaan API yang deprecated, ' +
                'pelanggaran best practice Odoo, dan masalah keamanan akses.',

            expectedIssues: [
                {
                    severity: 'critical',
                    title: 'SQL Injection',
                    file: 'models/sale_order.py',
                    description:
                        'Metode get_custom_report_data() menggunakan interpolasi string Python (% operator) ' +
                        'untuk menyusun query SQL. Ini memungkinkan serangan SQL Injection. ' +
                        'Gunakan parameter binding dengan %s sebagai placeholder dan tuple sebagai argumen kedua pada cr.execute().'
                },
                {
                    severity: 'critical',
                    title: 'Missing super() in write',
                    file: 'models/sale_order.py',
                    description:
                        'Override method write() tidak memanggil super(). Ini menyebabkan data tidak benar-benar tersimpan ' +
                        'ke database dan merusak fungsionalitas inheritance chain. ' +
                        'Harus menggunakan return super().write(vals) atau return super(SaleOrderCustom, self).write(vals).'
                },
                {
                    severity: 'critical',
                    title: 'self.env.cr.commit()',
                    file: 'models/custom_report.py',
                    description:
                        'Pemanggilan self.env.cr.commit() secara manual di method action_confirm() sangat berbahaya. ' +
                        'Ini melanggar manajemen transaksi Odoo, dapat menyebabkan data inkonsisten, ' +
                        'dan membuat rollback tidak mungkin jika terjadi error setelahnya.'
                },
                {
                    severity: 'warning',
                    title: '@api.multi deprecated',
                    file: 'models/sale_order.py',
                    description:
                        'Dekorator @api.multi sudah deprecated sejak Odoo 13. ' +
                        'Di Odoo 13+, semua method secara default sudah menerima multi-recordset. ' +
                        'Hapus dekorator @api.multi dari method action_request_approval().'
                },
                {
                    severity: 'warning',
                    title: 'Hardcoded browse(1)',
                    file: 'models/sale_order.py',
                    description:
                        'Metode get_default_warehouse() menggunakan browse(1) dengan ID hardcoded. ' +
                        'ID record bisa berbeda di setiap database. Gunakan self.env.ref() dengan XML ID ' +
                        'atau search() dengan domain yang sesuai.'
                },
                {
                    severity: 'warning',
                    title: 'Bare except',
                    file: 'models/sale_order.py',
                    description:
                        'Method safe_compute_tax() menggunakan bare except (except tanpa tipe exception). ' +
                        'Ini akan menangkap semua exception termasuk SystemExit dan KeyboardInterrupt. ' +
                        'Gunakan except Exception: atau tipe exception yang lebih spesifik.'
                },
                {
                    severity: 'warning',
                    title: 'Search in for loop',
                    file: 'models/sale_order.py',
                    description:
                        'Method update_all_lines() melakukan search() di dalam for loop. ' +
                        'Ini menyebabkan N+1 query problem dan performa yang buruk. ' +
                        'Lakukan prefetch atau batch search di luar loop.'
                },
                {
                    severity: 'warning',
                    title: 'Missing _description',
                    file: 'models/custom_report.py',
                    description:
                        'Model custom.sales.report tidak memiliki atribut _description. ' +
                        'Sejak Odoo 12, setiap model baru wajib memiliki _description untuk aksesibilitas dan logging.'
                },
                {
                    severity: 'warning',
                    title: 'Missing _description',
                    file: 'models/inventory_check.py',
                    description:
                        'Model inventory.check tidak memiliki atribut _description. ' +
                        'Sejak Odoo 12, setiap model baru wajib memiliki _description untuk aksesibilitas dan logging.'
                },
                {
                    severity: 'warning',
                    title: 'Old-style field declaration',
                    file: 'models/custom_report.py',
                    description:
                        'Field name menggunakan fields.char (huruf kecil) alih-alih fields.Char (huruf kapital). ' +
                        'Deklarasi lowercase adalah gaya lama yang deprecated. ' +
                        'Gunakan fields.Char, fields.Integer, dll. dengan huruf kapital.'
                },
                {
                    severity: 'warning',
                    title: 'Computed field without store',
                    file: 'models/sale_order.py',
                    description:
                        'Field total_discount adalah computed field tanpa store=True. ' +
                        'Jika field ini digunakan untuk search, filter, atau group by, ' +
                        'maka harus ditambahkan store=True agar tersimpan di database.'
                },
                {
                    severity: 'warning',
                    title: 'Many2one without ondelete',
                    file: 'models/custom_report.py',
                    description:
                        'Field sale_order_id (Many2one ke sale.order) tidak mendefinisikan parameter ondelete. ' +
                        'Sebaiknya tambahkan ondelete="set null" atau ondelete="cascade" ' +
                        'untuk menentukan perilaku saat record terkait dihapus.'
                },
                {
                    severity: 'warning',
                    title: 'Missing license in manifest',
                    file: '__manifest__.py',
                    description:
                        'File __manifest__.py tidak memiliki key "license". ' +
                        'Sejak Odoo 14, field license wajib ada di manifest. ' +
                        'Tambahkan misalnya: \'license\': \'LGPL-3\' atau lisensi yang sesuai.'
                },
                {
                    severity: 'info',
                    title: 'Missing access rights for inventory.check',
                    file: 'security/ir.model.access.csv',
                    description:
                        'Model inventory.check tidak memiliki entri di ir.model.access.csv. ' +
                        'Pengguna tidak akan bisa mengakses menu atau data inventory check ' +
                        'tanpa hak akses yang didefinisikan.'
                },
                {
                    severity: 'info',
                    title: 'Missing access rights for inventory.check.line',
                    file: 'security/ir.model.access.csv',
                    description:
                        'Model inventory.check.line tidak memiliki entri di ir.model.access.csv. ' +
                        'Record lines tidak akan bisa diakses, sehingga fitur inventory check tidak berfungsi.'
                }
            ],

            expectedModels: [
                'sale.order (inherit)',
                'custom.sales.report',
                'custom.sales.report.line',
                'inventory.check',
                'inventory.check.line'
            ],

            expectedFlows: [
                {
                    model: 'sale.order',
                    states: ['draft', 'sent', 'sale', 'done', 'cancel']
                },
                {
                    model: 'custom.sales.report',
                    states: ['draft', 'confirmed', 'done']
                },
                {
                    model: 'inventory.check',
                    states: ['draft', 'checking', 'done', 'cancelled']
                }
            ],

            expectedStats: {
                modules: 1,
                models: 5,
                fields: '30+',
                methods: '15+',
                views: '6+',
                healthScore: '45-55 (indicating significant issues)'
            }
        };
    }


    // =========================================================================
    //  Public API
    // =========================================================================
    return {
        getTestFiles: getTestFiles,
        getExpectedResults: getExpectedResults
    };

})();
