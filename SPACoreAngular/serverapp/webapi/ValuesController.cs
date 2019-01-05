using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Cors;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SPACoreAngular.serverapp.models;

namespace SPACoreAngular.serverapp.webapi
{
    [Route("api/Values"),Produces("application/json"),EnableCors("AppPolicy")]
    [ApiController]
    public class ValuesController : ControllerBase
    {
        private SPACoreAngularContext _ctx;
        public ValuesController(SPACoreAngularContext context)
        {
            _ctx = context; 
        }

        //GET: api/values/GetUser
        [HttpGet,Route("GetUser")]
        public async Task<object> GetUser()
        {
            List<User> users = null;
            object result = null;
            try
            {
                using (_ctx)
                {
                    users = await _ctx.User.ToListAsync();
                    result = new { User };
                }
            }
            catch (Exception ex)
            {

                ex.ToString();
            }
            return users;
        }
        //GET api/Values/GetByID/5
        [HttpGet,Route("GetByID/{id}")]
        public async Task<User> GetUserBtID(int id)
        {
            User user = null;
            try
            {
                using (_ctx) {
                    user = _ctx.User.FirstOrDefault(e => e.Id == id);
                }
            }
            catch (Exception ex)
            {
                ex.ToString();
                throw;
            }
            return user;
        }

        //POST api/values/Save
        [HttpPost,Route("Save")]
        public async Task<object> Save([FromBody] UserModel model)
        {
            object result = null; string message = "";
            if (model==null)
            {
                return BadRequest();
            }
            using (_ctx)
            {
                using(var _ctxTransaction = _ctx.Database.BeginTransaction())
                {
                    try
                    {
                        if (model.id > 0)
                        {
                            var entityUpdate = _ctx.User.FirstOrDefault(e => e.Id == model.id);
                            if (entityUpdate!=null)
                            {
                                entityUpdate.FirstName = model.firstName;
                                entityUpdate.LastName = model.lastName;
                                entityUpdate.Phone = model.phone;
                                entityUpdate.Email = model.email;
                                await _ctx.SaveChangesAsync();
                            }
                        }
                        else
                        {
                            User user = new User {
                                FirstName = model.firstName,
                                LastName = model.lastName,
                                Email = model.email,
                                Phone = model.phone
                            };
                            _ctx.User.Add(user);
                            await _ctx.SaveChangesAsync();
                        }
                        _ctxTransaction.Commit();
                        message = "Saved Successfully";
                    }
                    catch (Exception ex)
                    {
                        _ctxTransaction.Rollback();
                        ex.ToString();
                        message = "Saved Error";
                    }
                    result = new { message };
                }
            }
            return result;
        }

        //DELETE api/values/DeleteByID/5
        [HttpDelete,Route("DeleteByID/{id}")]
        public async Task<object> DeleteByID(int id)
        {
            object result = null; string message = "";
            using (_ctx)
            {
                using(var _ctxTransaction = _ctx.Database.BeginTransaction())
                {
                    try
                    {
                        var idToRemove = _ctx.User.FirstOrDefault(e => e.Id == id);
                        if (idToRemove!=null)
                        {
                            _ctx.User.Remove(idToRemove);
                            await _ctx.SaveChangesAsync();
                        }
                        _ctxTransaction.Commit();
                        message = "Deleted Successfully";
                    }
                    catch (Exception ex)
                    {
                        _ctxTransaction.Rollback(); ex.ToString();
                        message = "Error on Deleting!!";
                    }
                    result = new { message };
                }
            }
            return result;
        }
    }
    
}