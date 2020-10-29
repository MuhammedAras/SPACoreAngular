/*
 * BiMasa Backend APIs
 *
 * No description provided (generated by Swagger Codegen https://github.com/swagger-api/swagger-codegen)
 *
 * OpenAPI spec version: 1.0.0
 * 
 * Generated by: https://github.com/swagger-api/swagger-codegen.git
 */
using System;
using System.Linq;
using System.IO;
using System.Text;
using System.Collections;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.ComponentModel.DataAnnotations;
using System.Runtime.Serialization;
using Newtonsoft.Json;

namespace IO.Swagger.Models
{ 
    /// <summary>
    /// 
    /// </summary>
    [DataContract]
    public partial class ClientRegistrationDTO : IEquatable<ClientRegistrationDTO>
    { 
        /// <summary>
        /// Gets or Sets ClientTitle
        /// </summary>
        [Required]
        [DataMember(Name="clientTitle")]
        public string ClientTitle { get; set; }

        /// <summary>
        /// Gets or Sets ClientAddress
        /// </summary>
        [Required]
        [DataMember(Name="clientAddress")]
        public string ClientAddress { get; set; }

        /// <summary>
        /// Gets or Sets ClientPhone
        /// </summary>
        [Required]
        [DataMember(Name="clientPhone")]
        public string ClientPhone { get; set; }

        /// <summary>
        /// Gets or Sets User
        /// </summary>
        [DataMember(Name="user")]
        public UserCreateRequest User { get; set; }

        /// <summary>
        /// Returns the string presentation of the object
        /// </summary>
        /// <returns>String presentation of the object</returns>
        public override string ToString()
        {
            var sb = new StringBuilder();
            sb.Append("class ClientRegistrationDTO {\n");
            sb.Append("  ClientTitle: ").Append(ClientTitle).Append("\n");
            sb.Append("  ClientAddress: ").Append(ClientAddress).Append("\n");
            sb.Append("  ClientPhone: ").Append(ClientPhone).Append("\n");
            sb.Append("  User: ").Append(User).Append("\n");
            sb.Append("}\n");
            return sb.ToString();
        }

        /// <summary>
        /// Returns the JSON string presentation of the object
        /// </summary>
        /// <returns>JSON string presentation of the object</returns>
        public string ToJson()
        {
            return JsonConvert.SerializeObject(this, Formatting.Indented);
        }

        /// <summary>
        /// Returns true if objects are equal
        /// </summary>
        /// <param name="obj">Object to be compared</param>
        /// <returns>Boolean</returns>
        public override bool Equals(object obj)
        {
            if (ReferenceEquals(null, obj)) return false;
            if (ReferenceEquals(this, obj)) return true;
            return obj.GetType() == GetType() && Equals((ClientRegistrationDTO)obj);
        }

        /// <summary>
        /// Returns true if ClientRegistrationDTO instances are equal
        /// </summary>
        /// <param name="other">Instance of ClientRegistrationDTO to be compared</param>
        /// <returns>Boolean</returns>
        public bool Equals(ClientRegistrationDTO other)
        {
            if (ReferenceEquals(null, other)) return false;
            if (ReferenceEquals(this, other)) return true;

            return 
                (
                    ClientTitle == other.ClientTitle ||
                    ClientTitle != null &&
                    ClientTitle.Equals(other.ClientTitle)
                ) && 
                (
                    ClientAddress == other.ClientAddress ||
                    ClientAddress != null &&
                    ClientAddress.Equals(other.ClientAddress)
                ) && 
                (
                    ClientPhone == other.ClientPhone ||
                    ClientPhone != null &&
                    ClientPhone.Equals(other.ClientPhone)
                ) && 
                (
                    User == other.User ||
                    User != null &&
                    User.Equals(other.User)
                );
        }

        /// <summary>
        /// Gets the hash code
        /// </summary>
        /// <returns>Hash code</returns>
        public override int GetHashCode()
        {
            unchecked // Overflow is fine, just wrap
            {
                var hashCode = 41;
                // Suitable nullity checks etc, of course :)
                    if (ClientTitle != null)
                    hashCode = hashCode * 59 + ClientTitle.GetHashCode();
                    if (ClientAddress != null)
                    hashCode = hashCode * 59 + ClientAddress.GetHashCode();
                    if (ClientPhone != null)
                    hashCode = hashCode * 59 + ClientPhone.GetHashCode();
                    if (User != null)
                    hashCode = hashCode * 59 + User.GetHashCode();
                return hashCode;
            }
        }

        #region Operators
        #pragma warning disable 1591

        public static bool operator ==(ClientRegistrationDTO left, ClientRegistrationDTO right)
        {
            return Equals(left, right);
        }

        public static bool operator !=(ClientRegistrationDTO left, ClientRegistrationDTO right)
        {
            return !Equals(left, right);
        }

        #pragma warning restore 1591
        #endregion Operators
    }
}